"""Local-only CN-Sim HTTP API. All OS operations stay in the disposable lab container."""

import csv, io, json, platform, threading
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, HTMLResponse
from html import escape
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .models import DeployRequest, ExperimentRequest, ProbeRequest, LinkRequest
from .controller import Controller, DATA
from .analysis import aggregate
from .lab import command

app = FastAPI(title="CN-Sim", version="1.0.0", docs_url=None, redoc_url=None)
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"]
)
controller = Controller()


@app.middleware("http")
async def local_requests(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("x-cn-sim") != "1":
            return JSONResponse(
                {"detail": "Missing local application header"}, status_code=403
            )
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
            return JSONResponse(
                {"detail": "Cross-origin mutation rejected"}, status_code=403
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'"
    )
    return response


@app.exception_handler(ValueError)
async def invalid(request, exc):
    return JSONResponse(
        {"detail": str(exc)}, status_code=409 if controller.state["busy"] else 400
    )


@app.on_event("shutdown")
def shutdown():
    controller.close()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "backend": "FRRouting + Linux network namespaces",
        "version": command("/usr/lib/frr/zebra", "--version").splitlines()[0],
        "architecture": platform.machine(),
        "protocols": ["RIP", "OSPF", "EIGRP"],
    }


@app.get("/api/state")
def state():
    return controller.snapshot()


@app.post("/api/lab/deploy")
def deploy(req: DeployRequest):
    return {
        "job": controller.start(
            lambda: controller.deploy(req), "Deploying virtual network"
        )
    }


@app.post("/api/lab/stop")
def stop():
    if controller.state["busy"]:
        controller.cancel.set()
        return {"status": "cancelling"}
    return {"job": controller.start(controller.destroy, "Removing virtual network")}


@app.post("/api/lab/link/{id}")
def link(id: str, req: LinkRequest):
    with controller.lock:
        if controller.state["busy"]:
            raise ValueError(
                "Wait for the experiment to finish before changing links manually"
            )
        if not controller.lab or id not in controller.lab.links:
            raise ValueError("Link is not deployed")
        controller.lab.link(id, req.up)
        controller.update(lab=controller.lab_public(), routes=controller.lab.routes())
    return {"up": req.up}


@app.get("/api/lab/node/{id}")
def inspect(id: str):
    with controller.lock:
        if controller.state["busy"]:
            raise ValueError(
                "Detailed inspection is available when the network is idle; live routes appear in the inspector"
            )
        return controller.inspect(id)


@app.post("/api/probe")
def probe(req: ProbeRequest):
    with controller.lock:
        if controller.state["busy"]:
            raise ValueError("Wait for the current experiment to finish")
        lab = controller.lab
        if (
            not lab
            or req.source not in lab.nodes
            or req.target not in lab.nodes
            or req.source == req.target
        ):
            raise ValueError("Choose two deployed devices")
        output = (
            lab.ping(req.source, req.target)
            if req.kind == "ping"
            else lab.trace(req.source, req.target)
        )
        controller.emit("probe", f"{req.kind}: {req.source} → {req.target}")
        return {
            "kind": req.kind,
            "output": output,
            "sourceIP": lab.nodes[req.source]["ip"],
            "targetIP": lab.nodes[req.target]["ip"],
        }


@app.post("/api/experiments")
def experiments(req: ExperimentRequest):
    return {
        "job": controller.start(
            lambda: controller.experiments(req), "Starting experiment batch"
        )
    }


@app.get("/api/results/{id}")
def result(id: str):
    with controller.lock:
        r = next((r for r in controller.results if r["id"] == id), None)
    if not r:
        raise HTTPException(404, "Result not found")
    return r


@app.get("/api/comparison")
def comparison(batch: str = ""):
    with controller.lock:
        rs = [r for r in controller.results if not batch or r["batch"] == batch]
    return aggregate(rs)


@app.get("/api/export/{id}/{format}")
def export(id: str, format: str):
    r = result(id)
    if format == "json":
        return Response(
            json.dumps(r, indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="CN-Sim-{r["protocol"]}-{id}.json"'
            },
        )
    if format == "csv":
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(
            [
                "packet",
                "sent_seconds",
                "status",
                "one_way_ms",
                "round_trip_ms",
                "payload_bytes",
                "captured_egress_nodes",
            ]
        )
        for p in r["packets"]:
            w.writerow(
                [
                    p["id"],
                    p["time"],
                    p["status"],
                    p["delay"],
                    p["rtt"],
                    p["bytes"],
                    " > ".join(h["node"] for h in p["hops"]),
                ]
            )
        return Response(
            out.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="CN-Sim-{r["protocol"]}-{id}.csv"'
            },
        )
    raise HTTPException(404, "Unknown export format")


@app.get("/api/capture/{id}/{node}")
def capture(id: str, node: str):
    r = result(id)
    if node not in {n["id"] for n in r["topology"]["nodes"]}:
        raise HTTPException(404, "Device not found")
    path = DATA / "runs" / id / (node + ".pcap")
    if not path.is_file():
        raise HTTPException(404, "Capture not available")
    return FileResponse(
        path,
        media_type="application/vnd.tcpdump.pcap",
        filename=f"{r['protocol']}-{node}.pcap",
    )


@app.get("/docs", include_in_schema=False, response_class=HTMLResponse)
def reference():
    schema = app.openapi()
    entries = "".join(
        "<tr><td>"
        + escape(method.upper())
        + "</td><td><code>"
        + escape(path)
        + "</code></td><td>"
        + escape(info.get("summary", ""))
        + "</td></tr>"
        for path, methods in schema["paths"].items()
        for method, info in methods.items()
    )
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CN-Sim API reference</title><link rel="stylesheet" href="/style.css"></head><body style="padding:30px;max-width:1100px;margin:auto"><a href="/">← CN-Sim workspace</a><h1 style="margin-top:25px">Local API reference</h1><p>Mutation requests require X-CN-Sim: 1 and JSON bodies. Only localhost hosts and same-origin browser mutations are accepted.</p><p><a href="/openapi.json">Download OpenAPI JSON</a></p><section class="panel section-space"><table class="data-table"><thead><tr><th>Method</th><th>Path</th><th>Operation</th></tr></thead><tbody>'
        + entries
        + '</tbody></table></section><h2 style="margin-top:25px">Request and response schemas</h2><pre class="terminal">'
        + escape(json.dumps(schema.get("components", {}), indent=2))
        + "</pre></body></html>"
    )


app.mount("/", StaticFiles(directory="/app/dist", html=True), name="frontend")
