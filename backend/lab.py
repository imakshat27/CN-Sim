import ipaddress
import json
import shutil
import signal
import subprocess as sp
import time
import uuid
from pathlib import Path

DAEMONS = {"RIP": "ripd", "OSPF": "ospfd", "EIGRP": "eigrpd"}


def command(*args, check=True, timeout=10):
    p = sp.run(
        [str(a) for a in args],
        stdout=sp.PIPE,
        stderr=sp.PIPE,
        text=True,
        timeout=timeout,
    )
    if check and p.returncode:
        raise RuntimeError(f"{args[0]} failed: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


class Lab:
    def __init__(self, topology, protocol, profile, folder, emit):
        self.topology = topology.dict()
        self.protocol = protocol
        self.profile = profile
        self.folder = Path(folder)
        self.emit = emit
        self.key = "cn" + uuid.uuid4().hex[:6]
        self.nodes = {n["id"]: dict(n) for n in self.topology["nodes"]}
        self.links = {l["id"]: dict(l) for l in self.topology["links"]}
        self.procs = []
        self.captures = []
        self.handles = []
        self.start_epoch = time.time()
        self.root = Path("/run/frr") / self.key
        self.namespaces = []

    def ns(self, node):
        return self.key + "_" + node

    def exec(self, node, *args, **kw):
        return command("ip", "netns", "exec", self.ns(node), *args, **kw)

    def spawn(self, node, args, out):
        handle = open(out, "w")
        self.handles.append(handle)
        p = sp.Popen(
            ["ip", "netns", "exec", self.ns(node), *map(str, args)],
            stdout=handle,
            stderr=sp.STDOUT,
            start_new_session=True,
        )
        self.procs.append(p)
        return p

    def build(self, cancel):
        self.folder.mkdir(parents=True, exist_ok=True)
        for i, (id, n) in enumerate(self.nodes.items(), 1):
            if cancel.is_set():
                raise RuntimeError("Cancelled")
            command("ip", "netns", "add", self.ns(id))
            self.namespaces.append(id)
            command("ip", "-n", self.ns(id), "link", "set", "lo", "up")
            n["interfaces"] = []
            if n["type"] == "router":
                n["ip"] = f"10.255.0.{i}"
                command(
                    "ip", "-n", self.ns(id), "addr", "add", n["ip"] + "/32", "dev", "lo"
                )
            self.exec(
                id,
                "sysctl",
                "-qw",
                "net.ipv4.ip_forward=" + ("1" if n["type"] == "router" else "0"),
            )
            for scope in ("all", "default", "lo"):
                self.exec(id, "sysctl", "-qw", f"net.ipv4.conf.{scope}.rp_filter=0")
        for i, (id, l) in enumerate(self.links.items(), 1):
            a, b = f"a{i}", f"b{i}"
            command("ip", "link", "add", a, "type", "veth", "peer", "name", b)
            l["ends"] = {}
            for iface, node, host in [(a, l["a"], 1), (b, l["b"], 2)]:
                ip = f"10.0.{i}.{host}"
                command("ip", "link", "set", iface, "netns", self.ns(node))
                command(
                    "ip", "-n", self.ns(node), "addr", "add", ip + "/30", "dev", iface
                )
                command("ip", "-n", self.ns(node), "link", "set", iface, "up")
                self.exec(node, "sysctl", "-qw", f"net.ipv4.conf.{iface}.rp_filter=0")
                self.exec(
                    node,
                    "tc",
                    "qdisc",
                    "replace",
                    "dev",
                    iface,
                    "root",
                    "netem",
                    "limit",
                    "1000",
                    "delay",
                    f"{l['delay']}ms",
                    "loss",
                    f"{l['loss']}%",
                    "rate",
                    f"{l['bandwidth']}mbit",
                )
                self.nodes[node]["interfaces"].append(
                    {
                        "name": iface,
                        "ip": ip,
                        "link": id,
                        "peer": l["b"] if node == l["a"] else l["a"],
                    }
                )
                l["ends"][node] = iface
                if self.nodes[node]["type"] == "host":
                    self.nodes[node]["ip"] = ip
            for node in (l["a"], l["b"]):
                if self.nodes[node]["type"] == "host":
                    peer = l["b"] if node == l["a"] else l["a"]
                    gateway = next(
                        x["ip"]
                        for x in self.nodes[peer]["interfaces"]
                        if x["link"] == id
                    )
                    self.exec(node, "ip", "route", "add", "default", "via", gateway)
            if not l["up"]:
                for node, iface in l["ends"].items():
                    command("ip", "-n", self.ns(node), "link", "set", iface, "down")
        # Capture egress only. Each routing transmission is counted once per link.
        for id, n in self.nodes.items():
            n["ifindex"] = {
                x["ifindex"]: x["ifname"]
                for x in json.loads(self.exec(id, "ip", "-j", "link"))
                if x["ifname"] != "lo"
            }
            p = self.spawn(
                id,
                [
                    "tcpdump",
                    "-Z",
                    "root",
                    "-i",
                    "any",
                    "-Q",
                    "out",
                    "-n",
                    "-U",
                    "-s",
                    "128",
                    "-c",
                    "200000",
                    "-w",
                    str(self.folder / (id + ".pcap")),
                    "ip proto 89 or ip proto 88 or udp port 520 or udp port 49000",
                ],
                self.folder / (id + "-capture.log"),
            )
            self.captures.append(p)
        time.sleep(0.15)
        self.routing_start = time.monotonic()
        for id, n in self.nodes.items():
            if n["type"] != "router":
                continue
            path = Path("/run/frr") / self.ns(id)
            path.mkdir(parents=True)
            path.chmod(0o777)
            base = f"hostname {id}\nlog stdout\n"
            zebra = base + "".join(
                f"interface {it['name']}\n bandwidth {max(1, round(self.links[it['link']]['bandwidth'] * 1000))}\n!\n"
                for it in n["interfaces"]
            )
            config = base
            for it in n["interfaces"]:
                l = self.links[it["link"]]
                config += f"interface {it['name']}\n"
                if self.protocol == "OSPF":
                    config += f" ip ospf network point-to-point\n ip ospf cost {max(1, int(100 / l['bandwidth']))}\n"
                    if self.profile == "lab":
                        config += (
                            " ip ospf hello-interval 1\n ip ospf dead-interval 4\n"
                        )
                if self.protocol == "EIGRP":
                    config += f" eigrp bandwidth {max(1, round(l['bandwidth'] * 1000))}\n delay {max(1, round(l['delay'] * 100))}\n"
                    if self.profile == "lab":
                        config += " ip hello-interval eigrp 1\n ip hold-time eigrp 4\n"
                config += "!\n"
            if self.protocol == "RIP":
                config += "router rip\n version 2\n network 10.0.0.0/8\n redistribute connected\n"
                if self.profile == "lab":
                    config += " timers basic 5 30 20\n"
            elif self.protocol == "OSPF":
                config += f"router ospf\n ospf router-id {n['ip']}\n network 10.0.0.0/8 area 0\n"
            else:
                config += f"router eigrp 100\n eigrp router-id {n['ip']}\n network 10.0.0.0/8\n"
                for it in n["interfaces"]:
                    config += f" no passive-interface {it['name']}\n"
            if self.protocol == "EIGRP":
                offset = config.index("router eigrp 100")
                config = base + config[offset:] + "!\n" + config[len(base) : offset]
            n["config"] = config
            n["runtime_path"] = str(path)
            # Modern FRR routes configuration through one management daemon per pathspace.
            # Start daemons first, then apply the integrated configuration via vtysh.
            integrated = path / "frr.conf"
            integrated.write_text(zebra + "!\n" + config)
            for daemon in ("zebra", "mgmtd", DAEMONS[self.protocol]):
                p = self.spawn(
                    id,
                    [
                        f"/usr/lib/frr/{daemon}",
                        "-N",
                        self.ns(id),
                        "-i",
                        path / (daemon + ".pid"),
                        "-z",
                        path / "zserv.api",
                        "--vty_socket",
                        path,
                        "-A",
                        "127.0.0.1",
                        "-u",
                        "frr",
                        "-g",
                        "frr",
                        "--limit-fds",
                        "1024",
                    ],
                    self.folder / (id + "-" + daemon + ".log"),
                )
                for _ in range(30):
                    if (path / (daemon + ".vty")).exists() or p.poll() is not None:
                        break
                    time.sleep(0.05)
                if p.poll() is not None:
                    raise RuntimeError(
                        f"{id}: {daemon} failed: "
                        + (self.folder / (id + "-" + daemon + ".log")).read_text()[
                            -500:
                        ]
                    )
            # Backend connections to mgmtd are asynchronous; allow them to register before loading.
            time.sleep(0.2)
            command("vtysh", "--vty_socket", path, "-f", integrated, timeout=15)
        self.started = time.monotonic()
        self.emit(
            "system",
            f"{self.protocol}: {len(self.nodes)} devices, {len(self.links)} links created",
        )

    def routes(self):
        result = {}
        for id, n in self.nodes.items():
            try:
                result[id] = json.loads(
                    self.exec(id, "ip", "-j", "-4", "route", "show", timeout=3)
                )
            except Exception:
                result[id] = []
        return result

    def signature(self, routes):
        return json.dumps(
            {
                k: sorted(
                    [
                        (
                            r.get("dst", "default"),
                            r.get("gateway", ""),
                            r.get("dev", ""),
                            json.dumps(r.get("nexthops", []), sort_keys=True),
                            str(r.get("protocol", "")),
                        )
                        for r in v
                    ]
                )
                for k, v in routes.items()
            },
            sort_keys=True,
        )

    def reachable(self, source):
        seen = {source}
        todo = [source]
        while todo:
            a = todo.pop()
            for l in self.links.values():
                if not l["up"] or a not in (l["a"], l["b"]):
                    continue
                b = l["b"] if a == l["a"] else l["a"]
                if b not in seen:
                    seen.add(b)
                    todo.append(b)
        return seen

    def complete(self, routes):
        for id, n in self.nodes.items():
            if n["type"] != "router":
                continue
            for target in self.reachable(id) - {id}:
                ip = ipaddress.ip_address(self.nodes[target]["ip"])
                if not any(
                    r.get("type") not in ("unreachable", "blackhole", "prohibit")
                    and ip
                    in ipaddress.ip_network(r.get("dst", "0.0.0.0/0"), strict=False)
                    for r in routes.get(id, [])
                ):
                    return False
        return True

    def inspect(self, id):
        n = self.nodes[id]
        if n["type"] == "host":
            return {
                "routes": self.routes().get(id, []),
                "details": self.exec(id, "ip", "addr"),
                "config": "End host: directly connected interface + default gateway",
            }
        cmd = {
            "RIP": "show ip rip status",
            "OSPF": "show ip ospf neighbor",
            "EIGRP": "show ip eigrp neighbor",
        }[self.protocol]
        return {
            "routes_text": command(
                "vtysh",
                "--vty_socket",
                n["runtime_path"],
                "-c",
                "show ip route",
                timeout=5,
            ),
            "details": command(
                "vtysh", "--vty_socket", n["runtime_path"], "-c", cmd, timeout=5
            ),
            "config": n["config"],
        }

    def link(self, id, up):
        l = self.links[id]
        for node, iface in l["ends"].items():
            command(
                "ip", "-n", self.ns(node), "link", "set", iface, "up" if up else "down"
            )
        l["up"] = up
        self.emit("link", f"{l['a']} ↔ {l['b']}: {'UP' if up else 'DOWN'}")

    def trace(self, source, target):
        return self.exec(
            source,
            "traceroute",
            "-n",
            "-I",
            "-s",
            self.nodes[source]["ip"],
            "-q",
            "1",
            "-w",
            "1",
            "-m",
            "20",
            self.nodes[target]["ip"],
            timeout=25,
            check=False,
        )

    def ping(self, source, target):
        return self.exec(
            source,
            "ping",
            "-n",
            "-I",
            self.nodes[source]["ip"],
            "-c",
            "4",
            "-i",
            ".2",
            "-W",
            "1",
            self.nodes[target]["ip"],
            timeout=8,
            check=False,
        )

    def stop_capture(self):
        for p in self.captures:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        for p in self.captures:
            try:
                p.wait(timeout=3)
            except sp.TimeoutExpired:
                p.kill()
                p.wait()

    def close(self):
        for p in reversed(self.procs):
            if p.poll() is None:
                p.terminate()
        for p in reversed(self.procs):
            try:
                p.wait(timeout=2)
            except sp.TimeoutExpired:
                p.kill()
                p.wait()
        for h in self.handles:
            h.close()
        for id in self.namespaces:
            command("ip", "netns", "del", self.ns(id), check=False)
        for id in self.namespaces:
            shutil.rmtree(Path("/run/frr") / self.ns(id), ignore_errors=True)
