"""Exercise API guards, exports, cancellation, and lab cleanup against the running service."""

import json, urllib.request, urllib.error, time, http.client
from integration import api, wait, BASE


def status(path, data=None, headers=None):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers=headers or {},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


for attempt in range(30):
    try:
        api("/api/health")
        break
    except (OSError, http.client.HTTPException):
        time.sleep(1)
else:
    raise RuntimeError("Backend did not become healthy")

assert status("/api/health", headers={"Host": "untrusted.invalid"})[0] == 400
assert status("/api/lab/deploy", {}, {"Content-Type": "application/json"})[0] == 403
assert (
    status(
        "/api/lab/deploy",
        {},
        {
            "Content-Type": "application/json",
            "X-CN-Sim": "1",
            "Origin": "https://untrusted.invalid",
        },
    )[0]
    == 403
)
health = status("/api/health")
assert health[0] == 200 and "default-src 'self'" in health[2].get(
    "content-security-policy", health[2].get("Content-Security-Policy", "")
)
state = api("/api/state")
last = state["results"][-1]
id = last["id"]
assert json.loads(status("/api/export/" + id + "/json")[1])["id"] == id
assert status("/api/export/" + id + "/csv")[1].startswith(b"packet,sent_seconds")
assert status("/api/capture/" + id + "/PC1")[1][:4] in (
    b"\xd4\xc3\xb2\xa1",
    b"\xa1\xb2\xc3\xd4",
)
assert status("/api/capture/" + id + "/not-a-device")[0] == 404
assert status("/api/results/does-not-exist")[0] == 404
print("PASS: host/origin/header guards and JSON/CSV/PCAP exports", flush=True)
top = json.load(open("dist/examples/redundant.json"))
api(
    "/api/experiments",
    dict(
        topology=top,
        protocols=["OSPF"],
        source="PC1",
        target="PC2",
        duration=60,
        rate=20,
        size=256,
    ),
)
end = time.monotonic() + 90
while time.monotonic() < end:
    state = api("/api/state")
    if state["phase"] == "running" and state["elapsed"] >= 2:
        break
    if state["error"]:
        raise RuntimeError(state["error"])
    time.sleep(0.5)
else:
    raise RuntimeError("Experiment never started")
# A second job cannot replace a running experiment.
assert (
    status(
        "/api/lab/deploy",
        dict(topology=top),
        {"Content-Type": "application/json", "X-CN-Sim": "1"},
    )[0]
    == 409
)
api("/api/lab/stop", {})
state = wait()
last = state["results"][-1]
assert last["status"] == "cancelled" and 1 < last["metrics"]["duration"] < 10, last
api("/api/lab/stop", {})
state = wait()
assert state["lab"] is None
print(
    "PASS: single-job admission, cancellation, partial-duration measurement, lab teardown",
    flush=True,
)
