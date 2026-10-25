import {
  icon,
  esc,
  fmt,
  bytes,
  btn,
  panel,
  field,
  chart,
  scores,
  ring,
  color,
  topologySVG,
} from "./ui.js?v=20261025-2";
const journey = (step) => `<nav class="journey no-print" aria-label="Simulation steps">${[["workspace", "Build your network"], ["packets", "Follow a packet"], ["report", "See the results"]].map(([view, label], i) => `<a href="#${view}" class="${step === i + 1 ? "current" : step > i + 1 ? "done" : ""}" ${step === i + 1 ? 'aria-current="step"' : ''}><span>${step > i + 1 ? "✓" : i + 1}</span>${label}</a>`).join("")}</nav>`;
const head = (number, title, subtitle, actions = "") =>
  `<div class="page-heading"><div><p class="eyebrow"><span class="slash">/</span> ${number} · ROUTING LABORATORY</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions no-print">${actions}</div></div>`;
const stat = (label, value, unit, sub, ic = "activity") =>
  `<div class="stat"><div class="stat-top">${label}${icon(ic)}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-bottom">${sub}</div></div>`;
export function liveBanner(s) {
  return `<div id="live-banner" class="live-banner ${s.snap.error ? "error" : ""}" ${!s.snap.error ? "hidden" : ""}><span>${s.snap.busy ? '<span class="spinner" style="display:inline-block;margin-right:7px"></span>' : ""}<span id="live-message">${esc(s.snap.message)}</span></span>${s.snap.busy ? btn("Stop", "stop", "stop", "small danger") : ""}</div>`;
}
export function stats(s) {
  const live = s.snap.live || {},
    r = s.activeResult?.metrics;
  const active = s.snap.busy && live.sent !== undefined;
  return `<div class="stats" id="stats">${stat("NETWORK DEVICES", fmt(s.topology.nodes.length, 0), "devices", `${s.topology.nodes.filter((n) => n.type === "router").length} routers · ${s.topology.nodes.filter((n) => n.type === "host").length} end hosts`, "network")}${stat("ACTIVE CONNECTIONS", fmt(s.topology.links.filter((l) => (!s.dirty && s.snap.lab?.links?.[l.id] ? s.snap.lab.links[l.id].up : l.up)).length, 0), "links", s.topology.links.length + " total connections", "link")}${stat("PACKETS DELIVERED", active ? fmt(live.delivered, 0) : r ? fmt(r.delivered, 0) : "—", "packets", active ? `${fmt(live.sent, 0)} sent · run in progress` : r ? `${fmt(r.delivery, 1)}% delivery · latest experiment` : "Run an experiment to measure", "packet")}${stat("ONE-WAY LATENCY", active ? "Measuring" : r ? fmt(r.meanDelay, 1) : "—", active ? "" : "ms", r ? "Mean of delivered UDP probes" : "Measured with a shared kernel clock", "clock")}</div>`;
}
export function settings(s) {
  const c = s.config,
    b = s.snap.busy,
    ds = s.topology.nodes.map((n) => [n.id, n.id]);
  return `<div class="panel-title"><h2>Experiment setup</h2>${icon("settings")}</div><div class="panel-body"><div class="segmented"><button data-action="mode-single" class="${c.mode === "single" ? "active" : ""}" ${b ? "disabled" : ""}>Single protocol</button><button data-action="mode-compare" class="${c.mode === "compare" ? "active" : ""}" ${b ? "disabled" : ""}>Compare all</button></div>${field(
    "ROUTING PROTOCOL",
    "protocol",
    c.protocol,
    {
      choices: [
        ["RIP", "RIPv2"],
        ["OSPF", "OSPFv2"],
        ["EIGRP", "EIGRP · AS 100"],
      ],
      disabled: b || c.mode === "compare",
    },
  )}<div class="field-row">${field("Source", "source", c.source, { choices: ds, disabled: b })}${field("Destination", "target", c.target, { choices: ds, disabled: b })}</div><div class="field-row">${field("Duration · seconds", "duration", c.duration, { min: 5, max: 120, disabled: b })}${field("Packets / second", "rate", c.rate, { min: 1, max: 100, disabled: b })}</div><div class="field-row">${field("Payload · bytes", "size", c.size, { min: 64, max: 1400, disabled: b })}${field("Repeated trials", "trials", c.trials, { choices: [1, 2, 3, 4, 5].map((n) => [n, n + " trial" + (n > 1 ? "s" : "")]), disabled: b })}</div>${field(
    "Timer profile",
    "timer_profile",
    c.timer_profile,
    {
      choices: [
        ["lab", "Lab · faster protocol timers"],
        ["standard", "Standard · FRR defaults"],
      ],
      disabled: b,
      help: "The same profile is applied to every protocol; exact timers appear in the report.",
    },
  )}<div class="divider"></div>${field("Scheduled link failure", "failure_link", c.failure_link, { choices: [["", "None · steady-state test"], ...s.topology.links.filter((l) => l.up).map((l) => [l.id, `${l.a} ↔ ${l.b}`])], disabled: b })}${c.failure_link ? field("Fail link at · seconds", "failure_at", c.failure_at, { min: 1, max: c.duration - 2, disabled: b }) : ""}<p class="run-note">${c.mode === "compare" ? "3 protocols" : "1 protocol"} × ${c.trials} trial${c.trials > 1 ? "s" : ""} · ${c.duration}s traffic each<br>Startup convergence is measured separately.</p></div>`;
}
export function inspector(s) {
  const sel = s.selected;
  if (!sel)
    return `<div class="panel-title"><h2>Inspector</h2>${icon("info")}</div><div class="empty-inspector">${icon("cursor")}<h3>A closer look</h3><p>Select a device or connection<br>to inspect its configuration.</p></div>`;
  if (sel.kind === "node") {
    const n = s.topology.nodes.find((n) => n.id === sel.id);
    if (!n) return "";
    const live = !s.dirty ? s.snap.lab?.nodes?.[n.id] : null;
    return `<div class="panel-title"><h2>${esc(n.id)}</h2><span class="tag teal">${n.type.toUpperCase()}</span></div><div class="panel-body"><div class="metric-list" style="padding:0"><div><span>IP address</span><b>${live?.ip || "Not deployed"}</b></div><div><span>Connections</span><b>${s.topology.links.filter((l) => [l.a, l.b].includes(n.id)).length}</b></div><div><span>Protocol</span><b>${live ? s.snap.lab.protocol : "—"}</b></div></div><div id="inspector-routes">${routeInspector(s, n.id)}</div><div class="divider"></div>${btn("Inspect routes & config", "inspect", "report", "small wide", !live || s.snap.busy ? "disabled" : "")}<div style="margin-top:7px">${btn("Remove device", "delete", "trash", "small ghost wide", s.snap.busy ? "disabled" : "")}</div></div>`;
  }
  const l = s.topology.links.find((l) => l.id === sel.id);
  if (!l) return "";
  const runtime = !s.dirty ? s.snap.lab?.links?.[l.id] : null;
  return `<div class="panel-title"><h2>${esc(l.a)} ↔ ${esc(l.b)}</h2><span class="tag ${!(runtime ? runtime.up : l.up) ? "red" : ""}">${runtime ? (runtime.up ? "LIVE" : "DOWN") : "DRAFT"}</span></div><div class="panel-body"><div class="field"><label for="link-bandwidth">Bandwidth · Mbps</label><input id="link-bandwidth" data-link-field="bandwidth" type="number" min="0.1" max="1000" step="0.1" value="${l.bandwidth}" ${s.snap.busy ? "disabled" : ""}></div><div class="field-row"><div class="field"><label for="link-delay">One-way delay · ms</label><input id="link-delay" data-link-field="delay" type="number" min="0" max="100" step="0.1" value="${l.delay}" ${s.snap.busy ? "disabled" : ""}></div><div class="field"><label for="link-loss">Link loss · %</label><input id="link-loss" data-link-field="loss" type="number" min="0" max="20" step="0.1" value="${l.loss || 0}" ${s.snap.busy ? "disabled" : ""}></div></div><p class="field-help">Rate, delay and loss apply in each direction. Redeploy after editing.</p><div class="divider"></div>${btn((runtime ? runtime.up : l.up) ? "Disconnect link" : "Reconnect link", "toggle-link", "activity", "small wide", s.snap.busy ? "disabled" : "")}<div style="margin-top:7px">${btn("Remove connection", "delete", "trash", "small ghost wide", s.snap.busy ? "disabled" : "")}</div></div>`;
}
export function routeInspector(s, id) {
  if (s.dirty || !s.snap.lab) return "";
  const routes = s.snap.routes?.[id] || [];
  return `<div class="section-label" style="margin-top:16px">LIVE KERNEL ROUTES <span class="tag">${routes.length}</span></div>${routes
    .slice(0, 7)
    .map(
      (r) =>
        `<div class="inspector-route">${esc(r.dst || "default")}<br><span class="muted">${esc(r.gateway ? "via " + r.gateway : r.dev ? "dev " + r.dev : "multipath")} · ${esc(r.protocol || "kernel")}</span></div>`,
    )
    .join(
      "",
    )}${routes.length > 7 ? `<p class="field-help">+ ${routes.length - 7} routes · inspect for details</p>` : ""}`;
}
export function workspace(s) {
  return (
    head(
      "01",
      'Your network. <span class="muted">Your experiment.</span>',
      "Drag routers and end hosts onto the canvas, connect them with wires, then run your simulation.",
      btn("Import", "import", "upload") +
        btn("Save topology", "save", "download") +
        btn("Example network", "example", "folder") +
        btn("Run simulation", "run", "play", "primary", s.snap.busy || s.offline ? "disabled" : ""),
    ) +
    liveBanner(s) +
    journey(1) +
    stats(s) +
    `<div class="workspace-grid"><aside class="panel device-sidebar"><div class="panel-title"><h2>Components</h2><span class="tag">02</span></div><div class="panel-body"><div class="section-label">DRAG ONTO THE CANVAS</div><button class="device-card palette-device" data-device-type="router" data-action="add-router" aria-label="Router — drag onto canvas or click to add" ${s.snap.busy ? "disabled" : ""}><span class="device-symbol">${icon("router")}</span><span><b>Router</b><small>Finds a path for packets</small></span><span class="plus" aria-hidden="true">⠿</span></button><button class="device-card palette-device" data-device-type="host" data-action="add-host" aria-label="End host — drag onto canvas or click to add" ${s.snap.busy ? "disabled" : ""}><span class="device-symbol host">${icon("host")}</span><span><b>End host</b><small>Sends and receives packets</small></span><span class="plus" aria-hidden="true">⠿</span></button><div class="divider"></div><div class="section-label">CONNECTIONS</div><button class="device-card" data-action="tool-connect" ${s.snap.busy ? "disabled" : ""}><span class="device-symbol host">${icon("link")}</span><span><b>Connect devices</b><small>Click any two devices to wire</small></span></button><p class="small-note">Drag a component here or click to add it. Draw a wire from a device’s + port to another device. Select a wire to edit its speed and delay.</p><div class="divider"></div><div class="section-label">CANVAS LEGEND</div><div class="legend-item"><span class="legend-line"></span> Connected link</div><div class="legend-item"><span class="legend-line fail"></span> Link down</div><div class="legend-item"><span class="legend-line trace"></span> Selected / traced</div></div><div class="sidebar-foot">${icon("info")} Up to 20 devices · 40 links</div></aside><section class="panel canvas-panel"><div class="canvas-toolbar"><div class="canvas-name">${icon("network")} Network topology <small>UNTITLED LAB</small></div><div class="tool-group"><button class="tool ${s.tool === "select" ? "active" : ""}" data-action="tool-select" title="Select and move (V)" aria-label="Select and move">${icon("cursor")}</button><button class="tool ${s.tool === "connect" ? "active" : ""}" data-action="tool-connect" title="Connect devices (C)" aria-label="Connect devices">${icon("link")}</button><button class="tool" data-action="undo" title="Undo (Ctrl / Cmd Z)" aria-label="Undo" ${!s.undo.length || s.snap.busy ? "disabled" : ""}>${icon("undo")}</button><button class="tool" data-action="delete" title="Delete selection" aria-label="Delete selection" ${!s.selected || s.snap.busy ? "disabled" : ""}>${icon("trash")}</button><button class="tool" data-action="clear" title="New empty topology" aria-label="New empty topology" ${s.snap.busy ? "disabled" : ""}>${icon("plus")}</button></div></div><div class="canvas-wrap"><div class="canvas-badge"><span class="status-dot ${s.dirty || !s.snap.lab ? "off" : ""}"></span><span id="canvas-badge-text">${s.dirty ? "UNAPPLIED CHANGES" : s.snap.lab ? "REAL NETWORK · " + s.snap.lab.protocol : "TOPOLOGY EDITOR"}</span></div><svg id="topology" class="topology-svg" viewBox="${550 - 550 / s.zoom} ${310 - 310 / s.zoom} ${1100 / s.zoom} ${620 / s.zoom}" aria-label="Interactive network topology">${topologySVG(s.topology, { selected: s.selected, live: !s.dirty ? s.snap.lab : null })}</svg>${s.tool === "connect" ? `<div class="connection-prompt">${s.connectSource ? "Now select the second device" : "Select the first device to connect"}</div>` : ""}<div class="canvas-zoom"><button data-action="zoom-out" aria-label="Zoom out">−</button><span>${Math.round(s.zoom * 100)}%</span><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-fit" aria-label="Reset zoom">⌖</button></div></div><div class="canvas-footer"><span><span class="status-dot small"></span> ${s.topology.nodes.length} devices <span class="footer-divider">/</span> ${s.topology.links.length} connections</span><span>Drag to move · + port to wire · Del to remove</span></div><div class="canvas-actions"><div style="display:flex;gap:6px">${btn("Ping", "ping", "activity", "small", s.snap.busy || s.dirty || !s.snap.lab ? "disabled" : "")}${btn("Traceroute", "trace", "trace", "small", s.snap.busy || s.dirty || !s.snap.lab ? "disabled" : "")}</div>${s.snap.lab ? btn("Stop network", "stop", "stop", "small danger", s.snap.busy ? "disabled" : "") : ""}${btn(s.snap.lab ? "Redeploy network" : "Deploy network", "deploy", "play", "small", s.snap.busy || s.offline ? "disabled" : "")}</div></section><aside class="right-sidebar"><section class="panel inspector" id="inspector">${inspector(s)}</section><section class="panel" id="settings">${settings(s)}</section></aside></div>${eventLog(s)}`
  );
}
export function eventRows(s) {
  const events = s.snap.events
    .filter((e) => s.logFilter === "all" || e.kind === s.logFilter)
    .slice(-80)
    .reverse();
  return events.length
    ? events
        .map(
          (e) =>
            `<div class="event-row"><span class="time">${new Date(e.epoch * 1000).toLocaleTimeString("en-GB", { hour12: false })}</span><span><span class="tag ${["error", "failure"].includes(e.kind) ? "red" : e.kind === "result" ? "teal" : ""}">${esc(e.kind.toUpperCase())}</span></span><span class="message">${esc(e.message)}</span></div>`,
        )
        .join("")
    : '<div class="log-empty">The network is quiet. Deploy a topology or run an experiment to see events here.</div>';
}
export function eventLog(s) {
  return panel(
    'Event stream <span class="tag" style="margin-left:5px">LIVE</span>',
    `<div class="event-table" id="event-rows">${eventRows(s)}</div>`,
    `<div class="log-tabs">${["all", "route", "link", "result"].map((f) => `<button data-action="log-filter" data-filter="${f}" class="${s.logFilter === f ? "active" : ""}">${f === "all" ? "All events" : f === "route" ? "Routing" : f === "link" ? "Links" : "Results"}</button>`).join("")}</div>`,
    "log-panel",
  );
}
export function runOptions(s) {
  return s.snap.results
    .slice()
    .reverse()
    .map(
      (r) =>
        `<option value="${r.id}" ${s.activeRun === r.id ? "selected" : ""}>${r.protocol} · trial ${r.trial} · ${new Date(r.created * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</option>`,
    )
    .join("");
}
export function traceView(s) {
  const r = s.activeResult;
  return (
    head(
      "02",
      "Follow the packet.",
      "Select a packet to follow its journey. Hover over a router to see its routing table for the selected protocol and run.",
      r
        ? `<div class="result-controls"><select class="select" id="run-select" aria-label="Select experiment">${runOptions(s)}</select>${btn("Export CSV", "export-csv", "download")}</div>`
        : "",
    ) +
    liveBanner(s) +
    journey(2) +
    (!r
      ? empty(
          s,
          "trace",
          "Nothing to trace. Yet.",
          "Run an experiment to capture real packets. Every probe receives a sequence number, so you can inspect its observed journey.",
        )
      : `<div class="step-next no-print"><div><b>Your packets are ready to explore</b><p>Choose a row in the packet list to replay its journey. When you’re ready, see the overall comparison.</p></div><a class="btn primary" href="#report">Next · See results →</a></div>` + traceContent(s, r) + controlPanel(r))
  );
}
function traceContent(s, r) {
  const filtered = r.packets.filter(
    (p) =>
      (s.packetFilter === "all" || p.status === s.packetFilter) &&
      (!s.packetSearch || String(p.id).includes(s.packetSearch)),
  );
  const pageSize = 75,
    pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    page = Math.min(s.packetPage, pages - 1);
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const p = r.packets.find((p) => p.id === s.selectedPacket) || r.packets[0];
  return `<div class="trace-layout"><div>${panel("The packet’s journey", `<div class="canvas-wrap" style="min-height:280px"><svg class="topology-svg" style="min-height:280px;height:330px" viewBox="0 0 1100 620" aria-label="Captured packet path">${topologySVG(r.topology, { trace: p, editable: false, inspectRoutes: true })}</svg><div class="canvas-badge">PACKET #${p?.id || "—"} · ${r.protocol}</div></div><div class="canvas-footer"><span>${r.config.source} → ${r.config.target}</span><span>Hover a router to see its recorded routing table</span></div>`)}<div class="section-space">${panel("Choose a packet to follow", `<div class="trace-table"><table class="data-table"><thead><tr><th>Packet</th><th>Sent at</th><th>Status</th><th>One-way</th><th>RTT</th><th>Observed hops</th></tr></thead><tbody>${visible.map((p) => `<tr class="clickable ${s.selectedPacket === p.id ? "selected" : ""}" data-action="select-packet" data-packet="${p.id}"><td class="mono">#${p.id}</td><td class="mono">${fmt(p.time, 3)}s</td><td><span class="packet-status ${p.status === "lost" ? "lost" : ""}">${p.status}</span></td><td class="mono">${fmt(p.delay, 2)} ms</td><td class="mono">${fmt(p.rtt, 2)} ms</td><td>${p.hops.length}</td></tr>`).join("")}</tbody></table></div><div class="canvas-footer"><span>${filtered.length} matching packets · page ${page + 1}/${pages}</span><span>${btn("Previous", "packet-prev", "", "small", page === 0 ? "disabled" : "")}${btn("Next", "packet-next", "", "small", page >= pages - 1 ? "disabled" : "")}</span></div>`, `<div style="display:flex;gap:7px"><input id="packet-search" aria-label="Search packet number" placeholder="# packet" value="${esc(s.packetSearch)}" style="width:72px;border:1px solid #e0e7eb;border-radius:4px;font:9px var(--mono);padding:5px"><select id="packet-filter" aria-label="Packet status" style="font-size:9px;border:1px solid #e0e7eb;border-radius:4px;padding:5px">${["all", "delivered", "lost"].map((x) => `<option ${x === s.packetFilter ? "selected" : ""}>${x}</option>`).join("")}</select></div>`)}</div></div><aside><section class="panel trace-details"><div class="panel-title"><h2>Packet #${p?.id || "—"}</h2><span class="packet-status ${p?.status === "lost" ? "lost" : ""}">${p?.status || "unknown"}</span></div><div class="trace-selection"><span class="mono">${r.config.source}</span> <span class="muted">→</span> <span class="mono">${r.config.target}</span><p>${r.config.size} byte UDP payload · sequence-correlated</p></div>${p ? `<div class="metric-list"><div><span>Sent at</span><b>${fmt(p.time, 4)} s</b></div><div><span>One-way delay</span><b>${fmt(p.delay, 3)} ms</b></div><div><span>Round-trip delay</span><b>${fmt(p.rtt, 3)} ms</b></div></div><div class="section-label" style="padding:12px 18px 0">CAPTURED EGRESS OBSERVATIONS</div>${p.hops.map((h, i) => `<div class="trace-step"><span class="step-dot">${i + 1}</span><div><b>${esc(h.node)} <span class="tag">${esc(h.interface || "egress")}</span></b><p>${fmt(h.time, 6)}s · ${h.ip_bytes} IPv4 bytes</p><a style="font-size:9px" href="/api/capture/${r.id}/${encodeURIComponent(h.node)}" download>Download device PCAP ↗</a></div></div>`).join("")}${p.status === "delivered" ? `<div class="trace-step"><span class="step-dot">✓</span><div><b>${esc(r.config.target)} · received</b><p>Delivery confirmed by UDP receiver</p></div></div>` : `<div class="trace-step"><span class="step-dot" style="color:var(--red)">×</span><div><b>Not received within drain window</b><p>${esc(p.error || "The capture alone does not establish a drop cause.")}</p></div></div>`}` : ""}<div class="panel-body"><p class="small-note">Egress timestamps come from tcpdump's realtime clock. One-way latency uses the shared monotonic clock and is not inferred from the animation.</p>${btn("View real traceroute", "result-trace", "trace", "small wide")}</div></section></aside></div>`;
}
function empty(s, ic, title, desc) {
  return `<section class="panel empty-state">${icon(ic)}<h2>${title}</h2><p>${desc}</p><a class="btn primary" href="#workspace">${icon("network")} Open workspace</a></section>`;
}
export function reportView(s) {
  const rs = s.batchRuns.filter((r) => r.status === "completed"),
    batches = [
      ...new Map(
        s.snap.results
          .filter((r) => r.status === "completed")
          .map((r) => [r.batch, r]),
      ).values(),
    ].reverse();
  const actions = rs.length
    ? `<div class="result-controls"><select class="select" id="batch-select" aria-label="Select comparison batch">${batches.map((b) => `<option value="${b.batch}" ${s.selectedBatch === b.batch ? "selected" : ""}>${new Date(b.created * 1000).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${s.snap.results.filter((r) => r.batch === b.batch).length} runs</option>`).join("")}</select>${btn("Export report", "export-report", "download")}${btn("Print / PDF", "print", "print")}</div>`
    : "";
  return (
    head(
      "03",
      "The routing report.",
      "See how each routing protocol performed. Start with the coloured scores, then explore delivery, delay, recovery and the raw measurements.",
      actions,
    ) +
    liveBanner(s) +
    journey(3) +
    (rs.length
      ? reportContent(s, rs)
      : empty(
          s,
          "report",
          "Let the numbers tell the story.",
          "Your comparison report will appear after the first experiment. Run all three protocols on the same network to compare their behavior.",
        ))
  );
}
function reportContent(s, rs) {
  const protocols = ["RIP", "OSPF", "EIGRP"].filter((p) =>
      rs.some((r) => r.protocol === p),
    ),
    groups = protocols.map((p) => {
      const runs = rs.filter((r) => r.protocol === p),
        m = {};
      for (const k of Object.keys(runs[0].metrics)) {
        const values = runs
          .map((r) => r.metrics[k])
          .filter((v) => v !== null && typeof v === "number");
        m[k] = values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null;
      }
      const values = runs.map((r) => scores(r.metrics, r.failureAt !== null));
      const score = {};
      for (const k of Object.keys(values[0]))
        score[k] = values.reduce((sum, v) => sum + v[k], 0) / values.length;
      return { protocol: p, runs, metrics: m, score };
    });
  const latest = groups.map((g) => g.runs.at(-1)),
    c = rs[0].config;
  const winner = groups
    .slice()
    .sort((a, b) => b.score.total - a.score.total)[0];
  const rows = [
    ["Delivery ratio", "delivery", "%", 1],
    ["Packet loss", "loss", "%", 1],
    ["Mean one-way delay", "meanDelay", "ms", 2],
    ["95th percentile delay", "p95Delay", "ms", 2],
    ["Mean round-trip delay", "meanRTT", "ms", 2],
    ["Delay variation¹", "jitter", "ms", 2],
    ["Payload goodput", "throughput", "Mbps", 4],
    ["Offered payload load", "offeredLoad", "Mbps", 4],
    ["Startup convergence²", "initialConvergence", "s", 3],
    ["Failure route convergence²", "routeConvergence", "s", 3],
    ["Data-plane recovery³", "recovery", "s", 3],
    ["Routing packet transmissions", "controlMessages", "", 0],
    ["Routing IPv4 bytes", "controlBytes", "bytes", 0],
    ["Startup routing bytes", "startupControlBytes", "bytes", 0],
    ["Observed route-table changes", "routeChanges", "", 0],
    ["Local send errors", "sourceErrors", "", 0],
    ["Probes generated", "sent", "", 0],
    ["Probes delivered", "delivered", "", 0],
  ];
  return `${rs.flatMap((r) => (r.warnings?.length ? r.warnings : r.protocol === "EIGRP" && r.failureAt !== null && (r.metrics.recovery === null || r.metrics.routeConvergence === null) ? ["Full EIGRP recovery was not confirmed in this FRRouting experiment. Interpret this as an implementation-specific result; see the methodology and KNOWN_LIMITATIONS.md."] : []).map((w) => `<div class="report-note warning"><b>${r.protocol} · trial ${r.trial}:</b> ${esc(w)}</div>`)).join("")}<div class="report-hero"><div><p class="eyebrow">EXPERIMENT ${esc(s.selectedBatch.toUpperCase())}</p><h2>Different protocols. Same conditions.</h2><p>${rs[0].topology.nodes.length} devices · ${rs[0].topology.links.length} links · ${c.source} → ${c.target} · ${c.duration}s of traffic · ${c.rate} packets/s · ${c.size} byte payload<br>${c.failure_link ? `Link ${c.failure_link} fails at ${c.failure_at}s` : "Steady-state test · no scheduled failure"} · ${c.timer_profile === "lab" ? "Lab timer profile" : "Standard FRR timer profile"} · ${rs.length} completed run${rs.length > 1 ? "s" : ""}</p></div><div class="report-marker">${protocols.length === 3 ? "THREE-PROTOCOL COMPARISON" : "SINGLE-PROTOCOL EXPERIMENT"}</div></div><div class="score-grid" style="grid-template-columns:repeat(${groups.length}, minmax(0,1fr))">${groups
    .map(
      (g) =>
        `<section class="score-card"><div class="score-heading"><span class="protocol-badge">${g.protocol}<small>${g.protocol === "RIP" ? "Distance vector · hop count" : g.protocol === "OSPF" ? "Link state · shortest path" : "Advanced distance vector · DUAL"}</small></span><span class="tag ${g === winner ? "teal" : ""}">${g.runs.length} trial${g.runs.length > 1 ? "s" : ""}</span></div><div class="ring-wrap">${ring(g.score.total)}<div class="score-description"><strong class="${color(g.score.total)}">${g.score.total >= 80 ? "Strong result" : g.score.total >= 60 ? "Mixed result" : "Needs attention"}</strong><span>A weighted score for this experiment, using the formula below.</span></div></div>${[
          ["Delivery", g.score.delivery],
          ["Latency", g.score.latency],
          ["Convergence", g.score.convergence],
          ["Control efficiency", g.score.overhead],
        ]
          .map(
            ([name, v]) =>
              `<div class="score-row"><span>${name}</span><span class="mini-track"><span style="width:${v}%"></span></span><b class="mono ${color(v)}">${fmt(v, 0)}%</b></div>`,
          )
          .join(
            "",
          )}<div class="score-foot">${g.metrics.routeConvergence === null && c.failure_link ? "Route convergence was not confirmed in the observation window." : "Scores summarize this configuration and workload."}</div></section>`,
    )
    .join(
      "",
    )}</div><div class="report-note"><b>How to read the circles.</b> These are project-defined scores, not standard protocol efficiency percentages. Overall = 40% delivery + 20% latency + 25% convergence + 15% control efficiency. Green ≥ 80, yellow ≥ 60, red &lt; 60. Missing convergence or delay observations receive 0 for that component. <a href="#methodology">See formulas and measurement definitions ↗</a></div><div class="chart-grid">${chart(latest, "throughput", "Payload goodput over time", "Mbps")}${chart(latest, "delay", "One-way delay over time", "ms")}</div>${panel(
    "Measured performance",
    `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>MEASUREMENT · ${groups.some((g) => g.runs.length > 1) ? "MEAN ± SAMPLE SD" : "OBSERVED VALUE"}</th>${groups.map((g) => `<th>${g.protocol} · n=${g.runs.length}</th>`).join("")}</tr></thead><tbody>${rows
      .map(
        ([name, key, unit, d]) =>
          `<tr><td>${name}</td>${groups
            .map((g) => {
              const vals = g.runs
                  .map((r) => r.metrics[key])
                  .filter((v) => v !== null && typeof v === "number"),
                std =
                  vals.length > 1
                    ? Math.sqrt(
                        vals.reduce(
                          (sum, v) => sum + (v - g.metrics[key]) ** 2,
                          0,
                        ) /
                          (vals.length - 1),
                      )
                    : null;
              return `<td class="mono">${fmt(g.metrics[key], d)}${std !== null ? " ± " + fmt(std, d) : ""}${g.metrics[key] !== null ? " " + unit : ""}${vals.length < g.runs.length ? ` <span class="tag amber">${vals.length}/${g.runs.length} observed</span>` : ""}</td>`;
            })
            .join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><div class="panel-body"><p class="small-note">¹ Mean absolute difference between consecutive delivered-packet delays. ² Route tables sampled approximately every 0.5s; startup requires 3s of stability, failure convergence requires 2s. ³ First full 1s send-time window with all expected probes delivered. “—” means unavailable or not confirmed, never zero. Charts show the last trial per protocol and group packets by send second.</p></div>`,
    '<span class="tag">REAL BACKEND OBSERVATIONS</span>',
  )}<div class="section-space">${panel("Reproducibility & raw data", `<div class="panel-body"><div class="batch-history">${rs.map((r) => `<div class="history-card"><b>${r.protocol} · trial ${r.trial}</b><small>${fmt(r.metrics.delivery, 1)}% delivered · ${fmt(r.metrics.meanDelay, 2)} ms</small><div style="display:flex;gap:6px;margin-top:13px"><a href="/api/export/${r.id}/json" class="btn small" download>JSON</a><a href="/api/export/${r.id}/csv" class="btn small" download>CSV</a><button class="btn small" data-action="open-run" data-run="${r.id}">Packets</button><button class="btn small" data-action="result-routes" data-run="${r.id}">Routes</button></div></div>`).join("")}</div><div class="divider"></div><p class="small-note">${esc(rs[0].environment.frr)} · Linux ${esc(rs[0].environment.kernel)} · ${esc(rs[0].environment.architecture)} · Independent namespaces in one Docker Linux VM. Results are software-routing observations on this machine, not Cisco hardware benchmarks. Full configurations, topology, route snapshots, traffic settings and measurements are included in JSON exports.</p></div>`)} </div>`;
}
export function methodology() {
  return (
    head(
      "04",
      "Understand the experiment.",
      "Learn what the simulator measures, how the scores are calculated, and what each result can tell you.",
    ) +
    `<div class="report-hero"><div><p class="eyebrow">REAL ROUTING · CUSTOM WORKSPACE</p><h2>The diagram is yours. The packets are real.</h2><p>The editor creates isolated Linux network stacks connected by virtual Ethernet links. FRRouting calculates routes. The Linux kernel forwards packets. PacketSim observes the experiment and presents the results.</p></div><span class="report-marker">FRROUTING + LINUX</span></div><div class="method-grid">${panel("", `<div class="method-card"><span class="method-num">01 / ROUTING</span><h2>Three actual implementations</h2><p><b>RIPv2:</b> FRR ripd exchanges distance vectors, uses hop count, and treats 16 as unreachable.</p><p><b>OSPFv2:</b> FRR ospfd runs in area 0, with point-to-point links. Link cost is max(1, floor(1000 / link Mbps)), using a 1,000 Mbps reference. A 100 Mbps link costs 10 and a 1,000 Mbps link costs 1; OSPF chooses the lowest total path cost.</p><p><b>EIGRP:</b> FRR eigrpd uses AS 100. Interface bandwidth is set in kbps; the delay metric is max(1, round(link milliseconds × 100)), in units of 10 μs.</p><p>These are FRRouting implementations. Protocol behavior and performance may differ from Cisco IOS. The tested FRR EIGRP build can leave stale next hops after link failure; affected runs receive a visible warning. Do not interpret that result as a general EIGRP protocol limitation.</p><p><a href="https://docs.frrouting.org/en/latest/" target="_blank" rel="noreferrer">FRRouting documentation ↗</a></p></div>`)}${panel("", `<div class="method-card"><span class="method-num">02 / LINK CONDITIONS</span><h2>A network you can control</h2><p>Each connection is a virtual Ethernet pair. Linux tc/netem enforces its rate, one-way delay, and random loss in each direction, with a 1,000-packet queue limit.</p><p>A scheduled failure administratively brings both ends down. This models immediate carrier loss, rather than a silent neighbor that times out. Initial link-up states reset independently for each trial.</p><p>The same topology, traffic rate, payload size, failure timing, and timer policy apply to every protocol. Later trials rotate protocol order. Trials run sequentially to reduce competing workload.</p></div>`)}${panel("", `<div class="method-card"><span class="method-num">03 / MEASUREMENT</span><h2>Observe before interpreting</h2><p>Fixed-rate UDP probes carry a sequence number and monotonic send timestamp. The receiver logs arrival and echoes the packet. Sent/received IDs determine delivery and loss.</p><p>Namespaces share the same Linux monotonic clock, allowing direct one-way delay measurement. Echoes provide RTT separately. Goodput counts received application payload bytes over traffic duration, excluding protocol headers.</p><p>Delay variation is the mean absolute difference between consecutive delivered probes; this definition is not iperf3's jitter estimator. Two seconds are allowed to drain in-flight probes. Link loss is stochastic, so repeated trials are recommended.</p></div>`)}${panel("", `<div class="method-card"><span class="method-num">04 / CONVERGENCE</span><h2>Routing and forwarding are separate</h2><p>Startup waits for all graph-reachable endpoint addresses to have kernel routes and for route tables to remain stable for 3 seconds. OSPF must also have minimum-cost next hops installed before traffic begins; temporary higher-cost startup routes do not count as ready. The final observed change is reported as startup convergence.</p><p>After a failure, route convergence is the last observed route change followed by at least 2 stable seconds with complete routes. Tables are sampled approximately every 0.5s. Unconfirmed convergence is left unavailable.</p><p>Data-plane recovery is the start of the first full one-second send-time window after failure in which every expected probe arrives. Successful forwarding can recover before the entire routing domain settles.</p></div>`)}${panel("", `<div class="method-card"><span class="method-num">05 / PACKET INSPECTION</span><h2>Captured hops, not invented journeys</h2><p>tcpdump captures IPv4 egress in every device namespace. UDP sequence numbers correlate observations to each probe. Captures use a 128-byte snapshot, enough for headers and the probe identifier.</p><p>Routing overhead counts RIP, OSPF, and EIGRP IPv4 bytes once at each link egress. Data bytes use the same boundary and include probes and their echoes. Startup overhead is reported separately from the traffic window.</p><p>Traceroute sends independent ICMP probes. Its output is a diagnostic snapshot; it does not establish the path of every data packet. Packet animations use captured egress observations.</p></div>`)}${panel("", `<div class="method-card"><span class="method-num">06 / SCORING</span><h2>Explicit, adjustable interpretation</h2><p>The score targets are fixed for comparisons in this project: 50ms latency and 2s convergence. They are explanatory choices, not protocol standards.</p><div class="formula">Delivery = received / sent × 100<br>Latency = 100 / (1 + mean_ms / 50)<br>Convergence = 100 / (1 + seconds / 2)<br>Control efficiency = data_bytes /<br>(data_bytes + routing_bytes) × 100<br><br>Overall = 0.40D + 0.20L + 0.25C + 0.15E</div><p>Failure experiments use route recovery for C; steady-state tests use startup convergence. Missing measurements score 0 for that component. Repeated-trial scores are averaged. Always interpret scores alongside raw metrics.</p></div>`)}${panel("", `<div class="method-card"><span class="method-num">07 / TIMER PROFILES</span><h2>Choose and disclose the policy</h2><p><b>Lab:</b> RIP update/timeout/garbage timers 5/30/20s; OSPF hello/dead 1/4s; EIGRP hello/hold 1/4s.</p><p><b>Standard:</b> FRR defaults are retained. Typical RIP timers are 30/180/120s, OSPF point-to-point hello/dead 10/40s, and EIGRP hello/hold 5/15s.</p><p>“Same profile” means a consistent policy, not identical mechanisms. Administrative link-down detection bypasses silent-neighbor dead timers. Exact generated configurations are exported with each result.</p></div>`)}${panel("", `<div class="method-card"><span class="method-num">08 / LIMITS</span><h2>What the results can support</h2><p>All routers share a machine and a Docker Linux VM. CPU scheduling, probe scheduling, packet capture, and host load add timing variation. These experiments evaluate this software implementation under the recorded conditions.</p><p>One OSPF area, one EIGRP autonomous system, IPv4, and point-to-point links are supported. Hosts have one connection. Multi-area routing, wireless links, NAT and vendor-specific hardware behavior are outside this workbench.</p><p>Topology and settings save in this browser; completed results and captures persist in the Docker data volume. Keep the JSON and PCAP exports with your project report.</p></div>`)}</div>`
  );
}

function controlPanel(r) {
  const events = (r.controlEvents || []).slice(0, 120);
  return (
    '<div class="section-space">' +
    panel(
      "Routing message ledger",
      `<div class="trace-table"><table class="data-table"><thead><tr><th>Time</th><th>Device</th><th>Interface</th><th>Protocol</th><th>Source → destination</th><th>IPv4 bytes</th></tr></thead><tbody>${events.map((e) => `<tr><td class="mono">${fmt(e.time, 6)}s</td><td>${esc(e.node)}</td><td class="mono">${esc(e.interface)}</td><td><span class="tag teal">${esc(e.protocol)}</span></td><td class="mono">${esc(e.source)} → ${esc(e.target)}</td><td class="mono">${e.bytes}</td></tr>`).join("")}</tbody></table></div><div class="panel-body"><p class="small-note">First ${events.length} indexed routing transmissions from the traffic window · ${r.metrics.controlMessages} total observed. Download device PCAPs for protocol headers, hello messages, advertisements and query/reply inspection in Wireshark.</p></div>`,
      '<span class="tag">CAPTURED ON EGRESS</span>',
    ) +
    "</div>"
  );
}
