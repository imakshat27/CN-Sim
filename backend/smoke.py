"""Disposable three-router smoke test, independent of the web service.
Run: docker compose run --rm lab python3 -m backend.smoke
"""

import json
import tempfile
import threading
import time

from .lab import Lab
from .models import Topology


def main():
    topology = Topology(
        nodes=[dict(id=f"R{i}", type="router", x=i * 200, y=200) for i in range(1, 4)],
        links=[dict(id="L1", a="R1", b="R2"), dict(id="L2", a="R2", b="R3")],
    )
    for protocol in ["RIP", "OSPF", "EIGRP"]:
        with tempfile.TemporaryDirectory() as folder:
            lab = Lab(topology, protocol, "lab", folder, lambda *args: None)
            try:
                lab.build(threading.Event())
                end = time.monotonic() + 60
                while not lab.complete(lab.routes()):
                    if time.monotonic() > end:
                        raise RuntimeError(protocol + " did not learn all routes")
                    time.sleep(0.5)
                ping = lab.ping("R1", "R3")
                if ", 0% packet loss" not in ping:
                    raise RuntimeError(protocol + " forwarding failed: " + ping)
                print(
                    json.dumps(dict(protocol=protocol, passed=True, ping=ping)),
                    flush=True,
                )
            finally:
                lab.close()


if __name__ == "__main__":
    main()
