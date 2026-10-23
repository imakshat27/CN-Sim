"""Check the real gateway and host/origin guards in disposable containers.

Run from the repository root after `docker compose build lab`.
Does not create a routing lab or disturb the running application.
"""

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def port(container):
    return json.loads(docker("inspect", container))[0]["NetworkSettings"]["Ports"][
        "8000/tcp"
    ][0]["HostPort"]


def request(port_number, path, credentials=None, origin=None, host=None, data=None):
    headers = {"Host": host or "packetsim.imakshat.com", "X-CN-Sim": "1"}
    if credentials:
        headers["Authorization"] = "Basic " + base64.b64encode(
            credentials.encode()
        ).decode()
    if origin:
        headers["Origin"] = origin
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"http://127.0.0.1:{port_number}{path}", headers=headers, data=data
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


name = "cn-sim-gateway-test-" + uuid.uuid4().hex[:8]
backend, gateway = name + "-lab", name + "-gateway"
image = os.environ.get("CN_SIM_TEST_IMAGE", "cn-sim-lab")
root = Path.cwd()
with tempfile.TemporaryDirectory() as directory:
    setup = [sys.executable, str(root / "deploy/configure.py"), "--user", "test"]
    subprocess.check_call(setup, cwd=directory)
    settings = Path(directory, ".env")
    login = Path(directory, ".deployment-login")
    assert settings.stat().st_mode & 0o777 == 0o600
    assert login.stat().st_mode & 0o777 == 0o600
    test_password = login.read_text().split("Password: ")[1].strip()
    hashed = settings.read_text().split("CN_SIM_PASSWORD_HASH='")[1].strip().strip("'")
    original = settings.read_bytes()
    assert subprocess.run(setup, cwd=directory, capture_output=True).returncode != 0
    assert settings.read_bytes() == original
try:
    docker("network", "create", name)
    docker(
        "run", "-d", "--name", backend, "--network", name,
        "--network-alias", "lab", "-p", "127.0.0.1::8000",
        "-v", f"{root / 'backend'}:/app/backend:ro",
        "-e", "CN_SIM_HOSTS=packetsim.imakshat.com",
        "-e", "CN_SIM_ORIGIN=https://packetsim.imakshat.com", image,
    )
    docker(
        "run", "-d", "--name", gateway, "--network", name,
        "-p", "127.0.0.1::8000",
        "-v", f"{root / 'deploy/Caddyfile'}:/etc/caddy/Caddyfile:ro",
        "-e", "CN_SIM_DOMAIN=http://packetsim.imakshat.com:8000",
        "-e", "CN_SIM_USER=test", "-e", f"CN_SIM_PASSWORD_HASH={hashed}",
        "caddy:2.10.2-alpine",
    )
    backend_port, gateway_port = port(backend), port(gateway)
    for _ in range(40):
        try:
            if request(backend_port, "/api/health")[0] == 200:
                break
        except OSError:
            pass
        time.sleep(0.25)
    else:
        raise RuntimeError("Test backend did not start")
    assert request(gateway_port, "/api/health")[0] == 401
    assert request(gateway_port, "/", "test:incorrect")[0] == 401
    auth = "test:" + test_password
    code, body = request(gateway_port, "/api/health", auth)
    assert code == 200 and json.loads(body)["ok"], (code, body)
    assert request(gateway_port, "/api/state", auth)[0] == 200
    assert request(backend_port, "/api/health", host="foreign.invalid")[0] == 400
    assert request(
        gateway_port, "/api/lab/deploy", auth,
        origin="https://foreign.invalid", data=b"{}",
    )[0] == 403
    assert request(
        gateway_port, "/api/lab/deploy", auth,
        origin="https://packetsim.imakshat.com", data=b"{}",
    )[0] == 422  # Passed the origin check; schema rejects a missing topology.
    print("PASS: gateway authentication, health/state, host guard and HTTPS origin guard")
finally:
    for container in (gateway, backend):
        subprocess.run(["docker", "rm", "-f", container], capture_output=True)
    subprocess.run(["docker", "network", "rm", name], capture_output=True)
