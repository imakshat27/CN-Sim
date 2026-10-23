"""Real backend integration. Run on the host with the service running; ~2 minutes."""

import http.client
import json
import pathlib
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"


def api(path, data=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json", "X-CN-Sim": "1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode())


def wait():
    end = time.monotonic() + 300
    last = None
    while time.monotonic() < end:
        s = api("/api/state")
        if s["phase"] != last:
            print(s["phase"], s["message"], flush=True)
            last = s["phase"]
        if not s["busy"]:
            if s["error"] and s["phase"] == "error":
                raise RuntimeError(s["error"])
            return s
        time.sleep(1)
    raise RuntimeError("Integration timeout")


if __name__ == "__main__":
    for attempt in range(30):
        try:
            api("/api/health")
            break
        except (OSError, http.client.HTTPException):
            time.sleep(1)
    else:
        raise RuntimeError("Backend did not become healthy")
    top = json.loads(pathlib.Path("dist/examples/redundant.json").read_text())
    existing = {r["id"] for r in api("/api/state")["results"]}
    api(
        "/api/experiments",
        dict(
            topology=top,
            protocols=["RIP", "OSPF", "EIGRP"],
            source="PC1",
            target="PC2",
            duration=12,
            rate=20,
            size=512,
            trials=1,
            failure_link="L3",
            failure_at=5,
            timer_profile="lab",
        ),
    )
    s = wait()
    results = [
        api("/api/results/" + r["id"]) for r in s["results"] if r["id"] not in existing
    ]
    assert len(results) == 3, results
    for r in results:
        m = r["metrics"]
        print(r["protocol"], json.dumps(m), flush=True)
        assert m["sent"] == 240, (r["protocol"], "send count", m)
        baseline = [p for p in r["packets"] if p["time"] < 4]
        assert (
            baseline
            and sum(p["status"] == "delivered" for p in baseline) / len(baseline) > 0.95
        ), (r["protocol"], "baseline delivery", m)
        assert m["controlBytes"] > 0, (r["protocol"], "control capture", m)
        assert any(p["hops"] for p in r["packets"]), (
            r["protocol"],
            "no packet captures",
        )
        assert r["failureAt"] is not None
    for r in results:
        if r["protocol"] == "EIGRP" and r["metrics"]["recovery"] is None:
            assert r.get("warnings"), "EIGRP failure must be disclosed"
            print(
                "OBSERVED: EIGRP did not recover; implementation warning present",
                flush=True,
            )
        elif r["protocol"] in ("RIP", "OSPF"):
            assert r["metrics"]["recovery"] is not None, (
                r["protocol"],
                "expected alternate-path recovery",
            )
    # Independent steady-state run validates every daemon and real forwarding without failure.
    api(
        "/api/experiments",
        dict(
            topology=top,
            protocols=["RIP", "OSPF", "EIGRP"],
            source="PC1",
            target="PC2",
            duration=5,
            rate=10,
            size=256,
            trials=1,
            timer_profile="lab",
        ),
    )
    after = wait()
    steady = [
        api("/api/results/" + r["id"])
        for r in after["results"]
        if r["id"] not in {x["id"] for x in s["results"]}
    ]
    assert len(steady) == 3
    for r in steady:
        assert r["metrics"]["sent"] == 50 and r["metrics"]["delivery"] >= 98, (
            r["protocol"],
            "steady state",
            r["metrics"],
        )
    probe = api("/api/probe", dict(source="PC1", target="PC2", kind="ping"))
    print(probe["output"], flush=True)
    assert ", 0% packet loss" in probe["output"], probe
    final = api("/api/state")
    assert not final["error"] and final["phase"] == "ready", final["message"]
    pathlib.Path("artifacts").mkdir(exist_ok=True)
    pathlib.Path("artifacts/integration-summary.json").write_text(
        json.dumps(
            [dict(protocol=r["protocol"], metrics=r["metrics"]) for r in results],
            indent=2,
        )
    )
    print(
        "PASS: all three steady-state protocols, packet capture correlation, failure injection, RIP/OSPF recovery and explicit EIGRP limitation reporting",
        flush=True,
    )
