import copy
import json
import os
import platform
import threading
import time
import uuid
from collections import deque
from pathlib import Path

from .analysis import aggregate, summarize
from .capture import read_capture
from .lab import Lab, command
from .models import DeployRequest

DATA = Path(os.environ.get("CN_SIM_DATA", "/data"))
DATA.mkdir(parents=True, exist_ok=True)


def lines(path):
    try:
        result = []
        for line in Path(path).read_text().splitlines():
            try:
                result.append(json.loads(line))
            except ValueError:
                pass
        return result
    except OSError:
        return []


class Controller:
    def __init__(self):
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.lab = None
        self.worker = None
        self.events = deque(maxlen=500)
        self.results = []
        self.state = {
            "busy": False,
            "phase": "idle",
            "message": "Ready to build a network",
            "progress": 0,
            "elapsed": 0,
            "live": {},
            "routes": {},
            "lab": None,
            "job": None,
            "error": None,
        }
        for p in sorted(
            (DATA / "runs").glob("*/result.json"), key=lambda p: p.stat().st_mtime
        )[-50:]:
            try:
                self.results.append(json.loads(p.read_text()))
            except (OSError, ValueError):
                pass

        self.monitor_stop = threading.Event()
        self.monitor = threading.Thread(target=self.monitor_idle, daemon=True)
        self.monitor.start()

    def monitor_idle(self):
        """Refresh actual routes after manual link changes as daemons converge."""
        while not self.monitor_stop.wait(1):
            with self.lock:
                if self.state["busy"] or not self.lab:
                    continue
                try:
                    routes = self.lab.routes()
                    if self.lab.signature(routes) != self.lab.signature(
                        self.state.get("routes", {})
                    ):
                        self.state["routes"] = routes
                        self.emit(
                            "route", self.lab.protocol + ": live kernel routes changed"
                        )
                    dead = any(p.poll() is not None for p in self.lab.daemon_procs)
                    if dead and not self.state.get("error"):
                        self.state.update(
                            error="A routing daemon exited. Redeploy the network to continue.",
                            phase="degraded",
                            message=self.lab.protocol
                            + ": routing daemon stopped; redeploy to restore the network",
                        )
                        self.emit("error", self.state["error"])
                except Exception as exc:
                    self.emit("error", "Live route inspection: " + str(exc))

    def emit(self, kind, message):
        with self.lock:
            self.events.append(
                {
                    "id": uuid.uuid4().hex[:10],
                    "epoch": time.time(),
                    "kind": kind,
                    "message": message,
                }
            )

    def update(self, **kw):
        with self.lock:
            self.state.update(kw)

    def snapshot(self):
        with self.lock:
            return {
                **copy.deepcopy(self.state),
                "events": list(self.events),
                "results": [self.brief(r) for r in self.results],
            }

    def brief(self, r):
        return {
            k: r[k]
            for k in (
                "id",
                "batch",
                "protocol",
                "trial",
                "status",
                "created",
                "metrics",
                "config",
            )
        }

    def start(self, fn, label):
        with self.lock:
            if self.state["busy"]:
                raise ValueError("An operation is already running")
            self.cancel.clear()
            self.state.update(
                busy=True,
                phase="starting",
                error=None,
                message=label,
                job=uuid.uuid4().hex[:10],
                progress=0,
            )

        def work():
            try:
                fn()
                self.update(
                    phase="cancelled" if self.cancel.is_set() else "ready",
                    message="Stopped" if self.cancel.is_set() else "Ready",
                    progress=100,
                )
            except Exception as e:
                self.emit(
                    "system" if self.cancel.is_set() else "error",
                    "Operation cancelled" if self.cancel.is_set() else str(e),
                )
                self.update(
                    phase="cancelled" if self.cancel.is_set() else "error",
                    error=None if self.cancel.is_set() else str(e),
                    message="Stopped" if self.cancel.is_set() else str(e),
                )
                if self.lab:
                    self.lab.close()
                    self.lab = None
                    self.update(lab=None, routes={})
            finally:
                self.update(busy=False)

        self.worker = threading.Thread(target=work, daemon=True)
        self.worker.start()
        return self.state["job"]

    def lab_public(self):
        if not self.lab:
            return None
        return {
            "protocol": self.lab.protocol,
            "timer_profile": self.lab.profile,
            "nodes": {
                k: {
                    x: v
                    for x, v in n.items()
                    if x in ("id", "type", "ip", "interfaces", "x", "y")
                }
                for k, n in self.lab.nodes.items()
            },
            "links": {
                k: {x: v for x, v in l.items() if x != "ends"}
                for k, l in self.lab.links.items()
            },
        }

    def deploy(self, req, folder=None):
        if self.lab:
            self.lab.close()
            self.lab = None
        self.update(
            phase="deploying",
            message=f"Creating {req.protocol} virtual routers…",
            lab=None,
            routes={},
            live={},
        )
        folder = folder or DATA / "manual" / uuid.uuid4().hex[:10]
        self.lab = Lab(req.topology, req.protocol, req.timer_profile, folder, self.emit)
        self.lab.build(self.cancel)
        self.update(lab=self.lab_public())
        self.update(
            phase="converging", message=f"{req.protocol}: waiting for routes to settle…"
        )
        start = self.lab.routing_start
        stable = time.monotonic()
        previous = None
        last_change = 0
        ready = False
        while time.monotonic() - start < 60:
            if self.cancel.is_set():
                raise RuntimeError("Cancelled during startup")
            routes = self.lab.routes()
            sig = self.lab.signature(routes)
            elapsed = time.monotonic() - start
            if sig != previous:
                stable = time.monotonic()
                last_change = elapsed
                previous = sig
                self.emit("route", f"{req.protocol}: routing tables updated")
            complete = self.lab.complete(routes)
            self.update(
                routes=routes,
                elapsed=round(elapsed, 1),
                message=f"{req.protocol}: startup {elapsed:.0f}s · {'routes complete, checking stability' if complete else 'learning remote routes'}",
            )
            dead = [p for p in self.lab.daemon_procs if p.poll() is not None]
            if dead:
                raise RuntimeError("A routing daemon exited. Inspect the server logs.")
            if complete and time.monotonic() - stable >= 3:
                ready = True
                break
            self.cancel.wait(0.5)
        if not ready:
            raise RuntimeError(
                f"{req.protocol} did not converge within 60 s. Check connectivity and daemon logs."
            )
        self.emit("system", f"{req.protocol}: routes complete and stable for 3 s")
        self.update(
            phase="ready",
            message=f"{req.protocol} network ready",
            lab=self.lab_public(),
        )
        return last_change, ready

    def destroy(self):
        if self.lab:
            self.lab.close()
            self.lab = None
        self.update(lab=None, routes={}, phase="idle", message="Network stopped")
        self.emit("system", "Virtual network removed")

    def experiments(self, req):
        batch = uuid.uuid4().hex[:12]
        completed = []
        total = len(req.protocols) * req.trials
        for trial in range(1, req.trials + 1):
            # Rotate order to reduce systematic first/last-protocol bias.
            order = (
                req.protocols[(trial - 1) % len(req.protocols) :]
                + req.protocols[: (trial - 1) % len(req.protocols)]
            )
            for protocol in order:
                if self.cancel.is_set():
                    return
                self.update(
                    progress=100 * len(completed) / total,
                    message=f"Trial {trial}: {protocol}",
                )
                id = uuid.uuid4().hex[:12]
                folder = DATA / "runs" / id
                initial, ready = self.deploy(
                    DeployRequest(
                        topology=req.topology,
                        protocol=protocol,
                        timer_profile=req.timer_profile,
                    ),
                    folder,
                )
                if self.cancel.is_set():
                    return
                self.emit(
                    "experiment",
                    f"{protocol} · trial {trial}/{req.trials} · {req.duration}s · {req.rate} packets/s",
                )
                rx = self.lab.spawn(
                    req.target,
                    ["python3", "/app/backend/probe.py", "rx"],
                    folder / "rx.jsonl",
                )
                for _ in range(30):
                    if lines(folder / "rx.jsonl") or rx.poll() is not None:
                        break
                    time.sleep(0.05)
                if rx.poll() is not None or not any(
                    row.get("ready") for row in lines(folder / "rx.jsonl")
                ):
                    raise RuntimeError("UDP receiver failed to start")
                start_ns = time.monotonic_ns()
                start_epoch = time.time()
                start = time.monotonic()
                tx = self.lab.spawn(
                    req.source,
                    [
                        "python3",
                        "/app/backend/probe.py",
                        "tx",
                        "--source",
                        self.lab.nodes[req.source]["ip"],
                        "--target",
                        self.lab.nodes[req.target]["ip"],
                        "--duration",
                        str(req.duration),
                        "--rate",
                        str(req.rate),
                        "--size",
                        str(req.size),
                    ],
                    folder / "tx.jsonl",
                )
                samples = []
                last_sig = None
                failed = None
                next_sample = 0
                self.update(
                    phase="running",
                    elapsed=0,
                    message=f"{protocol}: transmitting real UDP probes",
                )
                while tx.poll() is None:
                    elapsed = time.monotonic() - start
                    if self.cancel.is_set():
                        tx.terminate()
                        break
                    if (
                        req.failure_link
                        and failed is None
                        and elapsed >= req.failure_at
                    ):
                        self.lab.link(req.failure_link, False)
                        failed = time.monotonic() - start
                        self.update(lab=self.lab_public())
                        self.emit(
                            "failure",
                            f"{protocol}: scheduled link failure at {failed:.3f}s",
                        )
                    if elapsed >= next_sample:
                        routes = self.lab.routes()
                        sig = self.lab.signature(routes)
                        changed = last_sig is not None and last_sig != sig
                        if changed:
                            self.emit(
                                "route", f"{protocol}: route change at {elapsed:.3f}s"
                            )
                        samples.append(
                            {
                                "time": elapsed,
                                "signature": sig,
                                "complete": self.lab.complete(routes),
                                "changed": changed,
                                "routes": routes if changed or not samples else None,
                            }
                        )
                        last_sig = sig
                        next_sample = elapsed + 0.5
                        sent = lines(folder / "tx.jsonl")
                        received = lines(folder / "rx.jsonl")
                        n_sent = len([p for p in sent if "id" in p])
                        n_rx = len({p["id"] for p in received if "id" in p})
                        self.update(
                            routes=routes,
                            elapsed=round(min(elapsed, req.duration), 1),
                            live={
                                "sent": n_sent,
                                "delivered": n_rx,
                                "loss": max(0, n_sent - n_rx),
                                "protocol": protocol,
                                "trial": trial,
                                "total": total,
                                "completed": len(completed),
                                "failure": failed,
                            },
                            progress=100
                            * (len(completed) + min(elapsed / req.duration, 1))
                            / total,
                        )
                    if elapsed > req.duration + 8:
                        tx.kill()
                        raise RuntimeError("Traffic generator timeout")
                    self.cancel.wait(0.05)
                tx.wait(timeout=3)
                rx.terminate()
                rx.wait(timeout=3)
                self.lab.stop_capture()
                if not self.cancel.is_set() and tx.returncode != 0:
                    raise RuntimeError("Traffic generator failed")
                self.update(
                    phase="analyzing", message=f"{protocol}: analyzing packet captures…"
                )
                duration = (
                    min(req.duration, max(0.001, time.monotonic() - start))
                    if self.cancel.is_set()
                    else req.duration
                )
                captured = []
                for node, n in self.lab.nodes.items():
                    captured.extend(
                        read_capture(folder / (node + ".pcap"), node, n["ifindex"])
                    )
                sent = lines(folder / "tx.jsonl")
                received = lines(folder / "rx.jsonl")
                metrics, packets, bins, control = summarize(
                    sent,
                    received,
                    captured,
                    duration,
                    start_epoch,
                    start_ns,
                    req.rate,
                    req.size,
                    failed,
                    samples,
                    initial,
                    ready,
                )
                for p in packets:
                    if p["status"] == "delivered":
                        p["destination"] = req.target
                traceroute = (
                    self.lab.trace(req.source, req.target)
                    if not self.cancel.is_set()
                    else "Cancelled"
                )
                warnings = []
                if any(p.poll() is not None for p in self.lab.daemon_procs):
                    warnings.append(
                        protocol
                        + ": a routing process exited during the observation window. This run records the implementation failure; it must not be presented as successful protocol convergence."
                    )
                if (
                    protocol == "EIGRP"
                    and failed is not None
                    and (
                        metrics["recovery"] is None
                        or metrics["routeConvergence"] is None
                    )
                ):
                    warnings.append(
                        "FRRouting EIGRP did not confirm full recovery in this failure experiment. This is an implementation-specific observation, not evidence that EIGRP as a protocol cannot recover. Inspect the route snapshots and read KNOWN_LIMITATIONS.md before drawing protocol rankings."
                    )
                for node in self.lab.nodes:
                    if (
                        "200000 packets captured"
                        in (folder / (node + "-capture.log")).read_text()
                    ):
                        warnings.append(
                            node
                            + ": packet capture reached its limit; captured hop and overhead totals may be incomplete."
                        )
                result = {
                    "warnings": warnings,
                    "id": id,
                    "batch": batch,
                    "protocol": protocol,
                    "trial": trial,
                    "created": time.time(),
                    "status": "cancelled" if self.cancel.is_set() else "completed",
                    "config": req.dict(exclude={"topology", "protocols"}),
                    "topology": req.topology.dict(),
                    "metrics": metrics,
                    "packets": packets,
                    "bins": bins,
                    "controlEvents": [
                        {**e, "time": e["epoch"] - start_epoch} for e in control
                    ][:5000],
                    "routeSamples": [
                        {k: v for k, v in s.items() if k != "signature"}
                        for s in samples
                    ],
                    "routes": self.lab.routes(),
                    "traceroute": traceroute,
                    "failureAt": failed,
                    "environment": {
                        "frr": command(
                            "/usr/lib/frr/"
                            + {"RIP": "ripd", "OSPF": "ospfd", "EIGRP": "eigrpd"}[
                                protocol
                            ],
                            "--version",
                        ).splitlines()[0],
                        "kernel": platform.release(),
                        "architecture": platform.machine(),
                        "timer_profile": req.timer_profile,
                        "clock": "Shared Linux CLOCK_MONOTONIC; one-way UDP timestamps use the same kernel clock",
                        "capture": "IPv4 bytes at egress on all virtual interfaces; routing packet transmissions counted once per link",
                        "queue": "tc netem limit 1000; per-direction configured rate/delay/loss",
                        "measurement": "Packet delivery from received UDP sequence IDs; throughput is application payload goodput; startup is the last observed route change followed by 3 s stable/complete; failure convergence requires 2 s stable/complete; routing sampled every ~0.5 s.",
                    },
                    "configs": {
                        n: v.get("config", "End host: default gateway")
                        for n, v in self.lab.nodes.items()
                    },
                }
                (folder / "result.json").write_text(json.dumps(result, allow_nan=False))
                (folder / "summary.json").write_text(
                    json.dumps(
                        {
                            k: v
                            for k, v in result.items()
                            if k not in ("packets", "controlEvents", "routeSamples")
                        }
                    )
                )
                with self.lock:
                    self.results.append(result)
                completed.append(result)
                self.emit(
                    "result",
                    f"{protocol}: {metrics['delivery']:.1f}% delivered · {metrics['controlBytes']} control bytes",
                )
                self.update(lab=self.lab_public())
        (DATA / (batch + "-comparison.json")).write_text(
            json.dumps(aggregate(completed))
        )
        self.update(progress=100, message=f"{len(completed)} experiments completed")

    def inspect(self, node):
        if not self.lab or node not in self.lab.nodes:
            raise ValueError("Deploy this topology first")
        return self.lab.inspect(node)

    def close(self):
        self.monitor_stop.set()
        self.monitor.join(timeout=3)
        self.cancel.set()
        if self.worker and self.worker.is_alive():
            self.worker.join(timeout=15)
        if self.lab:
            self.lab.close()
