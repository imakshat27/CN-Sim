import { icon, esc, btn, fmt, topologySVG } from "./ui.js?v=20261025-2";
import {
  workspace,
  traceView,
  reportView,
  methodology,
  stats,
  settings,
  inspector,
  routeInspector,
  eventRows,
} from "./views.js?v=20261025-2";
import { simulationFinished, progressCopy, canvasPosition, devicePosition } from "./workflow.js?v=20261025-2";
const $ = (q, root = document) => root.querySelector(q),
  main = $("#main");
const configDefaults = {
  mode: "compare",
  protocol: "OSPF",
  source: "PC1",
  target: "PC2",
  duration: 25,
  rate: 20,
  size: 512,
  trials: 1,
  timer_profile: "lab",
  failure_link: "",
  failure_at: 10,
};
const s = {
  topology: { nodes: [], links: [] },
  config: { ...configDefaults },
  snap: {
    busy: false,
    phase: "idle",
    message: "Ready",
    events: [],
    results: [],
    live: {},
    routes: {},
  },
  selected: null,
  tool: "select",
  connectSource: null,
  dirty: true,
  undo: [],
  zoom: 1,
  offline: true,
  view: "workspace",
  cache: new Map(),
  activeRun: null,
  activeResult: null,
  selectedBatch: null,
  batchRuns: [],
  selectedPacket: 1,
  packetFilter: "all",
  packetSearch: "",
  packetPage: 0,
  logFilter: "all",
  drag: null,
  wire: null,
  pendingSimulation: null,
  modalBusy: false,
};
let restoredChecked = false;
let toastTimer,
  pollBusy = false,
  lastResultIDs = "",
  lastLiveKey = "",
  lastEvents = "",
  lastRoutes = "",
  currentProbe = "ping";
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 4500);
}
async function api(path, data) {
  const response = await fetch("/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CN-Sim": "1" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  if (!response.ok) {
    let message = body.detail || "Request failed";
    if (Array.isArray(message)) message = message.map((x) => x.msg).join("; ");
    throw Error(message);
  }
  return body;
}
function save() {
  try {
    localStorage.setItem(
      "cn-sim-workspace",
      JSON.stringify({ topology: s.topology, config: s.config }),
    );
  } catch {
    toast("Browser storage is full. Download your topology to save it.");
  }
}
function remember() {
  s.undo.push(structuredClone(s.topology));
  if (s.undo.length > 50) s.undo.shift();
}
function changed() {
  s.dirty = true;
  save();
}
function render() {
  const views = {
    workspace,
    packets: traceView,
    report: reportView,
    methodology,
  };
  main.innerHTML = views[s.view](s);
  $("#tabs").innerHTML = [
    ["workspace", "Workspace"],
    ["packets", "Packet journey"],
    ["report", "Results"],
    ["methodology", "Methodology"],
  ]
    .map(
      ([v, t]) =>
        `<a href="#${v}" class="${s.view === v ? "active" : ""}">${t}</a>`,
    )
    .join("");
  $("#rail-nav").innerHTML = [
    ["workspace", "network", "Workspace"],
    ["packets", "trace", "Packet journey"],
    ["report", "chart", "Results"],
    ["methodology", "book", "Methodology"],
  ]
    .map(
      ([v, i, t]) =>
        `<a class="rail-link ${s.view === v ? "active" : ""}" href="#${v}" title="${t}" aria-label="${t}">${icon(i)}</a>`,
    )
    .join("");
  renderLive();
  bindCanvas();
}
function renderLive() {
  updateTools();
  const el = $("#backend-state");
  el.innerHTML = `<span class="status-dot ${s.offline ? "off" : ""}"></span><span class="state-copy">${s.offline ? "Backend offline" : s.snap.busy ? "Experiment running" : "FRRouting connected"}</span>`;
  const banner = $("#live-banner");
  if (banner) {
    banner.hidden = !s.snap.error;
    banner.className = "live-banner " + (s.snap.error ? "error" : "");
    banner.innerHTML = `<span>${s.snap.busy ? '<span class="spinner" style="display:inline-block;margin-right:7px"></span>' : ""}${esc(s.snap.message)}${s.snap.busy ? ` <span class="mono" style="margin-left:10px">${fmt(s.snap.progress, 0)}%</span>` : ""}</span>${s.snap.busy ? btn("Stop", "stop", "stop", "small danger") : ""}`;
  }
  const progress = $("#simulation-progress");
  progress.hidden = !s.snap.busy;
  if (s.snap.busy) {
    const {title, detail} = progressCopy(s.snap);
    const percent = Math.max(0, Math.min(100, Number(s.snap.progress) || 0));
    progress.innerHTML = `<span class="progress-orbit"><span class="spinner"></span></span><div class="progress-copy"><strong>${esc(title)}</strong><span>${esc(detail)}</span><div class="progress-track" role="progressbar" aria-label="Simulation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><i style="width:${percent}%"></i></div></div><span class="progress-percent">${Math.round(percent)}%</span>${btn("Stop", "stop", "stop", "small ghost")}`;
  }
  if (s.view === "workspace") {
    $("#stats").outerHTML = stats(s);
    const badge = $("#canvas-badge-text");
    if (badge)
      badge.textContent = s.dirty
        ? "UNAPPLIED CHANGES"
        : s.snap.lab
          ? "REAL NETWORK · " + s.snap.lab.protocol
          : "TOPOLOGY EDITOR";
  }
}
function redrawTopology() {
  const svg = $("#topology");
  if (svg)
    svg.innerHTML = topologySVG(s.topology, {
      selected: s.selected,
      live: !s.dirty ? s.snap.lab : null,
    });
}
function updateTools() {
  const run = document.querySelector('[data-action="run"]');
  if (run) run.disabled = s.snap.busy || s.offline || Boolean(s.startingSimulation);
  const remove = document.querySelector('[data-action="delete"]');
  const undo = document.querySelector('[data-action="undo"]');
  if (remove) remove.disabled = s.snap.busy || !s.selected;
  if (undo) undo.disabled = s.snap.busy || !s.undo.length;
  for (const name of ["ping", "trace"]) {
    const button = document.querySelector(`[data-action="${name}"]`);
    if (button) button.disabled = s.snap.busy || s.dirty || !s.snap.lab;
  }
}
function redrawInspector() {
  updateTools();
  if ($("#inspector")) $("#inspector").innerHTML = inspector(s);
}
function redrawSettings() {
  if ($("#settings")) $("#settings").innerHTML = settings(s);
}
function route() {
  const hash = location.hash.slice(1);
  s.view = ["workspace", "packets", "report", "methodology"].includes(hash)
    ? hash
    : "workspace";
  render();
  window.scrollTo({top: 0, behavior: "smooth"});
}
function assertEditable() {
  if (s.snap.busy)
    throw Error("Wait for the current operation to finish, or stop it first.");
}
function validated(top) {
  if (!top || !Array.isArray(top.nodes) || !Array.isArray(top.links))
    throw Error("A topology needs nodes and links arrays.");
  if (top.nodes.length > 20 || top.links.length > 40)
    throw Error("Use at most 20 devices and 40 links.");
  const ids = new Set(),
    lids = new Set(),
    pairs = new Set();
  for (const n of top.nodes) {
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(n.id) ||
      ids.has(n.id) ||
      !["router", "host"].includes(n.type) ||
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y) ||
      n.x < 30 ||
      n.x > 1170 ||
      n.y < 30 ||
      n.y > 670
    )
      throw Error("Invalid device or duplicate device ID.");
    ids.add(n.id);
  }
  for (const l of top.links) {
    const pair = [l.a, l.b].sort().join("|");
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(l.id) ||
      lids.has(l.id) ||
      pairs.has(pair) ||
      !ids.has(l.a) ||
      !ids.has(l.b) ||
      l.a === l.b ||
      !Number.isFinite(l.bandwidth) ||
      l.bandwidth < 0.1 ||
      l.bandwidth > 1000 ||
      !Number.isFinite(l.delay) ||
      l.delay < 0 ||
      l.delay > 100 ||
      typeof l.up !== "boolean" ||
      (l.loss !== undefined &&
        (!Number.isFinite(l.loss) || l.loss < 0 || l.loss > 20))
    )
      throw Error("Invalid connection, bandwidth, delay, loss, or link state.");
    lids.add(l.id);
    pairs.add(pair);
    l.loss ??= 0;
  }
  return structuredClone(top);
}
function validateDeploy() {
  validated(s.topology);
  if (s.topology.nodes.length < 2 || !s.topology.links.length)
    throw Error("Connect at least two devices before deploying.");
  if (!s.topology.nodes.some((n) => n.type === "router"))
    throw Error("Add at least one router.");
  for (const n of s.topology.nodes.filter((n) => n.type === "host")) {
    const links = s.topology.links.filter((l) => [l.a, l.b].includes(n.id));
    if (links.length !== 1)
      throw Error(`${n.id} needs exactly one connection to a router.`);
    const l = links[0],
      peer = s.topology.nodes.find((x) => x.id === (l.a === n.id ? l.b : l.a));
    if (peer.type !== "router") throw Error("Connect hosts to routers.");
  }
}
function fixEndpoints() {
  const ids = s.topology.nodes.map((n) => n.id),
    hosts = s.topology.nodes.filter((n) => n.type === "host").map((n) => n.id);
  if (!ids.includes(s.config.source))
    s.config.source = hosts[0] || ids[0] || "";
  if (!ids.includes(s.config.target) || s.config.source === s.config.target)
    s.config.target =
      hosts.find((n) => n !== s.config.source) ||
      ids.find((n) => n !== s.config.source) ||
      "";
  if (
    s.config.failure_link &&
    !s.topology.links.some((l) => l.id === s.config.failure_link && l.up)
  )
    s.config.failure_link = "";
}
async function loadRun(id) {
  if (!s.cache.has(id)) s.cache.set(id, await api("/results/" + id));
  return s.cache.get(id);
}
async function selectRun(id) {
  s.activeRun = id;
  s.activeResult = await loadRun(id);
  s.selectedPacket = s.activeResult.packets[0]?.id || 1;
  s.packetPage = 0;
}
async function selectBatch(batch) {
  s.selectedBatch = batch;
  const ids = s.snap.results.filter((r) => r.batch === batch).map((r) => r.id);
  s.batchRuns = await Promise.all(ids.map(loadRun));
}
async function poll() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const previousBusy = s.snap.busy;
    const snap = await api("/state");
    const wasOffline = s.offline;
    s.offline = false;
    s.snap = snap;
    if (!restoredChecked) {
      restoredChecked = true;
      if (snap.lab) {
        const nodes = (t) =>
          Object.values(t)
            .map((n) => [n.id, n.type])
            .sort();
        const links = (t) =>
          Object.values(t)
            .map((l) => [
              l.id,
              l.a,
              l.b,
              l.bandwidth,
              l.delay,
              l.loss || 0,
              l.up,
            ])
            .sort();
        if (
          JSON.stringify(nodes(snap.lab.nodes)) ===
            JSON.stringify(nodes(s.topology.nodes)) &&
          JSON.stringify(links(snap.lab.links)) ===
            JSON.stringify(links(s.topology.links))
        )
          s.dirty = false;
      }
    }
    const ids = snap.results.map((r) => r.id).join(",");
    let resultsChanged = ids !== lastResultIDs;
    if (resultsChanged) {
      lastResultIDs = ids;
      const latest =
        snap.results.filter((r) => r.status === "completed").at(-1) ||
        snap.results.at(-1);
      if (latest) {
        await selectRun(latest.id);
        await selectBatch(latest.batch);
      }
    }
    const liveKey = JSON.stringify([
      snap.busy,
      snap.lab?.protocol,
      snap.lab?.links,
      s.offline,
    ]);
    if ((liveKey !== lastLiveKey || wasOffline) && !s.drag && !s.wire && !paletteDrag) {
      lastLiveKey = liveKey;
      if (s.view === "workspace") render();
    }
    if (s.view === "workspace") {
      const events = JSON.stringify(snap.events);
      if (events !== lastEvents) {
        lastEvents = events;
        $("#event-rows").innerHTML = eventRows(s);
      }
      const routes = JSON.stringify(snap.routes);
      if (routes !== lastRoutes) {
        lastRoutes = routes;
        if (s.selected?.kind === "node" && $("#inspector-routes"))
          $("#inspector-routes").innerHTML = routeInspector(s, s.selected.id);
      }
    }
    if (resultsChanged && ["packets", "report"].includes(s.view)) render();
    else renderLive();
    if (simulationFinished(s.pendingSimulation, snap)) {
      const fresh = snap.results.filter(r => r.status === "completed" && !s.pendingSimulation.before.includes(r.id));
      const latest = fresh.at(-1);
      await selectRun(latest.id);
      await selectBatch(latest.batch);
      s.pendingSimulation = null;
      if (s.view === "packets") render();
      else location.hash = "packets";
      toast("Simulation complete. Select a packet to explore its journey.");
    } else if (s.pendingSimulation && !snap.busy && snap.job === s.pendingSimulation.job) {
      s.pendingSimulation = null;
    }
    if (previousBusy && !snap.busy && snap.error) toast(snap.error);
  } catch (e) {
    if (!s.offline) {
      s.offline = true;
      renderLive();
      redrawSettings();
      toast(
        "Backend connection lost. Start Docker and run docker compose up -d.",
      );
    }
  } finally {
    pollBusy = false;
  }
}
function download(name, data, type = "application/json") {
  const blob = new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function modal(title, body) {
  $("#modal-content").innerHTML =
    `<div class="modal-header"><h2>${esc(title)}</h2>${btn("Close", "modal-close", "close", "small ghost")}</div><div class="modal-body">${body}</div>`;
  if (!$("#modal").open) $("#modal").showModal();
}
function probeModal(kind) {
  if (s.dirty) throw Error("Deploy the edited topology before probing.");
  currentProbe = kind;
  const choices = s.topology.nodes.map((n) => [n.id, n.id]);
  modal(
    kind === "ping" ? "Send a real ping" : "Run a real traceroute",
    `<p>Select the endpoints in your deployed ${s.snap.lab?.protocol} network.</p><div class="field-row" style="margin-top:18px"><div class="field"><label for="probe-source">Source</label><select id="probe-source">${choices.map(([v]) => `<option ${s.config.source === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div><div class="field"><label for="probe-target">Destination</label><select id="probe-target">${choices.map(([v]) => `<option ${s.config.target === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div></div>${btn(kind === "ping" ? "Send ping" : "Trace route", "probe-run", "play", "primary")}<pre id="probe-output">Ready.</pre>`,
  );
}
async function action(name, el) {
  if (name.startsWith("tool-")) {
    assertEditable();
    s.tool = name.slice(5);
    s.connectSource = null;
    render();
    return;
  }
  if (name.startsWith("mode-")) {
    assertEditable();
    s.config.mode = name.slice(5);
    save();
    redrawSettings();
    return;
  }
  if (name === "modal-close") {
    $("#modal").close();
    return;
  }
  if (name === "save") {
    download("PacketSim-topology.json", s.topology);
    toast("Topology downloaded.");
    return;
  }
  if (name === "import") {
    $("#import-file").click();
    return;
  }
  if (name === "example") {
    assertEditable();
    remember();
    s.topology = validated(
      await fetch("/examples/redundant.json").then((r) => r.json()),
    );
    s.selected = null;
    s.tool = "select";
    s.connectSource = null;
    s.config = {
      ...s.config,
      source: "PC1",
      target: "PC2",
      failure_link: "L3",
    };
    changed();
    render();
    toast("Redundant example topology loaded.");
    return;
  }
  if (name === "clear") {
    assertEditable();
    remember();
    s.topology = { nodes: [], links: [] };
    s.selected = null;
    s.config.failure_link = "";
    changed();
    render();
    return;
  }
  if (name === "undo") {
    assertEditable();
    if (s.undo.length) {
      s.topology = s.undo.pop();
      s.selected = null;
      s.connectSource = null;
      fixEndpoints();
      changed();
      render();
    }
    return;
  }
  if (name === "add-router" || name === "add-host") {
    addDevice(name === "add-router" ? "router" : "host");
    return;
  }
  if (name === "delete") {
    assertEditable();
    if (!s.selected) return;
    remember();
    const { kind, id } = s.selected;
    if (kind === "node") {
      s.topology.nodes = s.topology.nodes.filter((n) => n.id !== id);
      s.topology.links = s.topology.links.filter(
        (l) => ![l.a, l.b].includes(id),
      );
    } else s.topology.links = s.topology.links.filter((l) => l.id !== id);
    s.selected = null;
    s.connectSource = null;
    fixEndpoints();
    changed();
    render();
    return;
  }
  if (name.startsWith("zoom-")) {
    s.zoom =
      name === "zoom-fit"
        ? 1
        : Math.max(
            0.65,
            Math.min(2, s.zoom + (name === "zoom-in" ? 0.15 : -0.15)),
          );
    render();
    return;
  }
  if (name === "deploy") {
    validateDeploy();
    await api("/lab/deploy", {
      topology: s.topology,
      protocol: s.config.protocol,
      timer_profile: s.config.timer_profile,
    });
    s.dirty = false;
    s.snap.busy = true;
    s.snap.message = "Deploying virtual network…";
    s.snap.error = null;
    render();
    await poll();
    return;
  }
  if (name === "run") {
    validateDeploy();
    const c = s.config;
    if (c.source === c.target)
      throw Error("Choose different traffic endpoints.");
    assertEditable();
    if (s.startingSimulation) return;
    s.startingSimulation = true;
    const before = s.snap.results.map(r => r.id);
    let started;
    try {
      started = await api("/experiments", {
      ...c,
      protocols: c.mode === "compare" ? ["RIP", "OSPF", "EIGRP"] : [c.protocol],
      topology: s.topology,
      failure_link: c.failure_link || null,
    });
    } finally { s.startingSimulation = false; }
    s.pendingSimulation = {job: started.job, before};
    s.dirty = false;
    s.snap.busy = true;
    s.snap.phase = "starting";
    s.snap.message = "Starting experiment…";
    s.snap.error = null;
    render();
    await poll();
    return;
  }
  if (name === "stop") {
    s.pendingSimulation = null;
    await api("/lab/stop", {});
    toast(
      s.snap.busy
        ? "Stopping the current operation…"
        : "Removing virtual network…",
    );
    await poll();
    return;
  }
  if (name === "toggle-link") {
    assertEditable();
    const l = s.topology.links.find((l) => l.id === s.selected?.id);
    if (!l) return;
    const live = !s.dirty ? s.snap.lab?.links?.[l.id] : null,
      up = !(live ? live.up : l.up);
    if (live) {
      await api("/lab/link/" + l.id, { up });
      l.up = up;
      save();
      await poll();
    } else {
      remember();
      l.up = up;
      changed();
    }
    fixEndpoints();
    render();
    return;
  }
  if (name === "inspect") {
    const id = s.selected?.id;
    if (!id) return;
    modal(id + " · routing inspection", "<p>Reading real daemon state…</p>");
    const r = await api("/lab/node/" + encodeURIComponent(id));
    modal(
      id + " · routing inspection",
      `<h3>Routing table</h3><pre>${esc(r.routes_text || JSON.stringify(r.routes, null, 2))}</pre><h3>Protocol / interfaces</h3><pre>${esc(r.details)}</pre><h3>Generated configuration</h3><pre>${esc(r.config)}</pre>`,
    );
    return;
  }
  if (name === "ping" || name === "trace") {
    probeModal(name);
    return;
  }
  if (name === "probe-run") {
    if (s.modalBusy) return;
    s.modalBusy = true;
    el.disabled = true;
    $("#probe-output").textContent = "Running real network probes…";
    try {
      const r = await api("/probe", {
        kind: currentProbe,
        source: $("#probe-source").value,
        target: $("#probe-target").value,
      });
      $("#probe-output").textContent = r.output;
    } finally {
      s.modalBusy = false;
      if (document.contains(el)) el.disabled = false;
    }
    return;
  }
  if (name === "log-filter") {
    s.logFilter = el.dataset.filter;
    render();
    return;
  }
  if (name === "select-packet") {
    s.selectedPacket = Number(el.dataset.packet);
    render();
    return;
  }
  if (name === "packet-next" || name === "packet-prev") {
    s.packetPage = Math.max(
      0,
      s.packetPage + (name === "packet-next" ? 1 : -1),
    );
    render();
    return;
  }
  if (name === "result-trace") {
    modal(
      "Real traceroute snapshot",
      `<p>Independent ICMP diagnostic probes recorded after this run. This may differ from an individual UDP packet's path.</p><pre>${esc(s.activeResult?.traceroute)}</pre>`,
    );
    return;
  }
  if (name === "open-run") {
    await selectRun(el.dataset.run);
    location.hash = "packets";
    if (s.view === "packets") render();
    return;
  }
  if (name === "result-routes") {
    const r = await loadRun(el.dataset.run);
    modal(
      r.protocol + " · recorded router state",
      `<p>Final kernel routes and generated daemon configuration from this experiment.</p>${Object.entries(
        r.routes,
      )
        .map(
          ([id, routes]) =>
            `<h3>${esc(id)}</h3><pre>${esc(JSON.stringify(routes, null, 2))}</pre><pre>${esc(r.configs[id] || "End host")}</pre>`,
        )
        .join("")}`,
    );
    return;
  }
  if (name === "export-csv") {
    if (s.activeRun) location.href = "/api/export/" + s.activeRun + "/csv";
    return;
  }
  if (name === "export-report") {
    download("PacketSim-comparison-" + s.selectedBatch + ".json", {
      title: "PacketSim routing comparison",
      batch: s.selectedBatch,
      exported: new Date().toISOString(),
      scoring:
        "0.4 delivery + 0.2 latency + 0.25 convergence + 0.15 control efficiency. See methodology in README.",
      runs: s.batchRuns,
    });
    return;
  }
  if (name === "print") {
    window.print();
    return;
  }
}
document.addEventListener("click", (event) => {
  if (Date.now() < suppressPaletteClickUntil && event.target.closest("[data-device-type]")) { event.preventDefault(); return; }
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled) return;
  event.preventDefault();
  action(el.dataset.action, el).catch((e) => toast(e.message));
});
document.addEventListener("change", async (event) => {
  const el = event.target;
  try {
    if (el.matches("[data-config]")) {
      const name = el.dataset.config;
      const v =
        el.type === "number" ||
        ["duration", "rate", "size", "trials", "failure_at"].includes(name)
          ? Number(el.value)
          : el.value;
      s.config[name] = v;
      if (name === "failure_link") redrawSettings();
      save();
    }
    if (el.matches("[data-link-field]")) {
      assertEditable();
      const l = s.topology.links.find((l) => l.id === s.selected?.id);
      if (!l) return;
      const prop = el.dataset.linkField,
        value = Number(el.value),
        limits = { bandwidth: [0.1, 1000], delay: [0, 100], loss: [0, 20] };
      if (
        !Number.isFinite(value) ||
        value < limits[prop][0] ||
        value > limits[prop][1]
      )
        throw Error("Value is outside the supported range.");
      if (l[prop] !== value) remember();
      l[prop] = value;
      changed();
      redrawTopology();
      renderLive();
    }
    if (el.id === "run-select") {
      await selectRun(el.value);
      await selectBatch(s.activeResult.batch);
      render();
    }
    if (el.id === "batch-select") {
      await selectBatch(el.value);
      render();
    }
    if (el.id === "packet-filter") {
      s.packetFilter = el.value;
      s.packetPage = 0;
      render();
    }
    if (el.id === "import-file") {
      assertEditable();
      const file = el.files[0];
      if (!file) return;
      if (file.size > 1000000)
        throw Error("Topology files must be smaller than 1 MB.");
      const top = validated(JSON.parse(await file.text()));
      remember();
      s.topology = top;
      s.selected = null;
      s.connectSource = null;
      fixEndpoints();
      changed();
      render();
      el.value = "";
      toast("Topology imported.");
    }
  } catch (e) {
    toast(e.message);
    if (el.matches("[data-link-field]")) redrawInspector();
  }
});
let searchTimer;
document.addEventListener("focusout", (e) => {
  if (e.target.matches("[data-link-field]")) s.linkEditElement = null;
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (
    el.matches("[data-config]") &&
    el.type === "number" &&
    el.value !== "" &&
    Number.isFinite(Number(el.value))
  ) {
    s.config[el.dataset.config] = Number(el.value);
    save();
  }
  if (el.matches("[data-link-field]") && !s.snap.busy && el.value !== "") {
    const l = s.topology.links.find((l) => l.id === s.selected?.id),
      prop = el.dataset.linkField,
      value = Number(el.value),
      limits = { bandwidth: [0.1, 1000], delay: [0, 100], loss: [0, 20] };
    if (
      l &&
      Number.isFinite(value) &&
      value >= limits[prop][0] &&
      value <= limits[prop][1] &&
      l[prop] !== value
    ) {
      if (s.linkEditElement !== el) {
        remember();
        s.linkEditElement = el;
      }
      l[prop] = value;
      changed();
      redrawTopology();
      renderLive();
    }
  }
  if (e.target.id === "packet-search") {
    s.packetSearch = e.target.value;
    s.packetPage = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      $("#packet-search")?.focus();
      $("#packet-search")?.setSelectionRange(pos, pos);
    }, 350);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea") || $("#modal").open) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z") {
    e.preventDefault();
    action("undo", {}).catch((x) => toast(x.message));
  } else if (key === "delete" || key === "backspace") {
    e.preventDefault();
    action("delete", {}).catch((x) => toast(x.message));
  } else if (key === "c")
    action("tool-connect", {}).catch((x) => toast(x.message));
  else if (key === "v" || key === "escape")
    action("tool-select", {}).catch((x) => toast(x.message));
});
function addDevice(type, position) {
  assertEditable();
  if (s.topology.nodes.length >= 20) throw Error("The lab supports up to 20 devices.");
  remember();
  const prefix = type === "router" ? "R" : "PC";
  let i = 1;
  while (s.topology.nodes.some(n => n.id === prefix + i)) i++;
  const n = {id: prefix + i, type, ...devicePosition(
    position?.x ?? 190 + (s.topology.nodes.length % 5) * 165,
    position?.y ?? 125 + Math.floor(s.topology.nodes.length / 5) * 125)};
  s.topology.nodes.push(n);
  s.selected = {kind: "node", id: n.id};
  s.tool = "select";
  s.connectSource = null;
  fixEndpoints(); changed(); render();
}
let paletteDrag = null, suppressPaletteClickUntil = 0;
document.addEventListener("pointerdown", e => {
  const card = e.target.closest("[data-device-type]");
  if (!card || card.disabled || s.snap.busy || e.button !== 0) return;
  // Pointer dragging works with a mouse, pen or touch; keyboard clicks still add devices.
  e.preventDefault();
  card.focus();
  paletteDrag = {type: card.dataset.deviceType, x: e.clientX, y: e.clientY, pointer: e.pointerId, moved: false};
  card.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", e => {
  if (!paletteDrag || paletteDrag.pointer !== e.pointerId) return;
  if (Math.hypot(e.clientX - paletteDrag.x, e.clientY - paletteDrag.y) > 6) paletteDrag.moved = true;
  if (!paletteDrag.moved) return;
  let ghost = $("#palette-ghost");
  if (!ghost) {
    ghost = document.createElement("div"); ghost.id = "palette-ghost";
    ghost.innerHTML = icon(paletteDrag.type) + `<span>${paletteDrag.type === "router" ? "Router" : "End host"}</span>`;
    document.body.append(ghost);
  }
  ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px";
  const rect = $("#topology")?.getBoundingClientRect();
  const over = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  $(".canvas-wrap")?.classList.toggle("drop-ready", Boolean(over));
});
function finishPalette(e, cancelled = false) {
  if (!paletteDrag || paletteDrag.pointer !== e.pointerId) return;
  const drag = paletteDrag; paletteDrag = null;
  $("#palette-ghost")?.remove(); $(".canvas-wrap")?.classList.remove("drop-ready");
  suppressPaletteClickUntil = Date.now() + 450;
  if (cancelled) return;
  try {
    if (!drag.moved) { addDevice(drag.type); return; }
    const svg = $("#topology"), rect = svg?.getBoundingClientRect();
    if (rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom)
      addDevice(drag.type, canvasPosition(svg, e.clientX, e.clientY));
    else toast("Drop the component inside the network canvas.");
  } catch (error) { toast(error.message); }
}
document.addEventListener("pointerup", e => finishPalette(e));
document.addEventListener("pointercancel", e => finishPalette(e, true));
function bindCanvas() {
  const svg = $("#topology");
  if (!svg) return;
  svg.addEventListener("pointerdown", e => {
    if (s.snap.busy || e.button !== 0) return;
    const nodeEl = e.target.closest("[data-node]"), linkEl = e.target.closest("[data-link]");
    if (nodeEl) {
      const id = nodeEl.dataset.node;
      if (e.target.closest("[data-port]")) {
        e.preventDefault();
        s.wire = {from: id, x: e.clientX, y: e.clientY, moved: false};
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (s.tool === "connect" || s.connectSource) { connect(id); return; }
      s.selected = {kind: "node", id};
      const n = s.topology.nodes.find(n => n.id === id), point = canvasPosition(svg, e.clientX, e.clientY);
      s.drag = {id, dx: point.x - n.x, dy: point.y - n.y, original: structuredClone(s.topology), moved: false};
      svg.setPointerCapture(e.pointerId);
      redrawTopology(); redrawInspector();
    } else if (linkEl) {
      s.selected = {kind: "link", id: linkEl.dataset.link}; redrawTopology(); redrawInspector();
    } else {
      s.selected = null; s.connectSource = null; redrawTopology(); redrawInspector();
      $(".connection-prompt")?.remove();
    }
  });
  svg.addEventListener("pointermove", e => {
    if (s.wire) {
      if (Math.hypot(e.clientX - s.wire.x, e.clientY - s.wire.y) > 5) s.wire.moved = true;
      const from = s.topology.nodes.find(n => n.id === s.wire.from), point = canvasPosition(svg, e.clientX, e.clientY);
      let line = $("#wire-preview", svg);
      if (!line) { line = document.createElementNS("http://www.w3.org/2000/svg", "line"); line.id = "wire-preview"; svg.append(line); }
      for (const [key, val] of Object.entries({x1:from.x, y1:from.y, x2:point.x, y2:point.y})) line.setAttribute(key,val);
      return;
    }
    if (!s.drag) return;
    const n = s.topology.nodes.find(n => n.id === s.drag.id), point = canvasPosition(svg, e.clientX, e.clientY);
    const position = devicePosition(point.x - s.drag.dx, point.y - s.drag.dy);
    if (position.x !== n.x || position.y !== n.y) s.drag.moved = true;
    Object.assign(n, position); redrawTopology();
  });
  const end = e => {
    if (s.wire) {
      const wire = s.wire; s.wire = null; $("#wire-preview", svg)?.remove();
      if (e.type === "pointercancel") return;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]")?.dataset.node;
      s.connectSource = wire.from;
      if (target && target !== wire.from) connect(target);
      else if (!wire.moved) { s.tool = "connect"; s.selected = {kind:"node", id:wire.from}; render(); }
      else { s.connectSource = null; toast("Drop the wire on another device to connect it."); }
      return;
    }
    if (s.drag?.moved) { s.undo.push(s.drag.original); if (s.undo.length > 50) s.undo.shift(); save(); }
    s.drag = null; updateTools();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const node = e.target.closest("[data-node]");
    if (!node) return;
    e.preventDefault();
    if (e.target.closest("[data-port]") || s.tool === "connect" || s.connectSource) connect(node.dataset.node);
    else { s.selected = {kind:"node", id:node.dataset.node}; redrawInspector(); redrawTopology(); }
  });
}

function connect(id) {
  try {
    assertEditable();
    if (!s.connectSource) {
      s.connectSource = id;
      s.selected = { kind: "node", id };
      render();
      return;
    }
    const from = s.connectSource;
    s.connectSource = null;
    if (from === id) {
      render();
      return;
    }
    if (
      s.topology.links.some(
        (l) => [l.a, l.b].includes(from) && [l.a, l.b].includes(id),
      )
    )
      throw Error("These devices are already connected.");
    if (s.topology.links.length >= 40)
      throw Error("The lab supports 40 links.");
    for (const n of [from, id].map((id) =>
      s.topology.nodes.find((n) => n.id === id),
    )) {
      if (
        n.type === "host" &&
        s.topology.links.some((l) => [l.a, l.b].includes(n.id))
      )
        throw Error("Each end host supports one router connection.");
    }
    if (
      [from, id].every(
        (id) => s.topology.nodes.find((n) => n.id === id).type === "host",
      )
    )
      throw Error("Connect hosts to routers.");
    remember();
    let i = 1;
    while (s.topology.links.some((l) => l.id === "L" + i)) i++;
    const l = {
      id: "L" + i,
      a: from,
      b: id,
      bandwidth: 100,
      delay: 2,
      loss: 0,
      up: true,
    };
    s.topology.links.push(l);
    s.selected = { kind: "link", id: l.id };
    changed();
    render();
  } catch (e) {
    toast(e.message);
    render();
  }
}
window.addEventListener("hashchange", route);
async function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem("cn-sim-workspace"));
    if (saved) {
      s.topology = validated(saved.topology);
      s.config = { ...configDefaults, ...saved.config };
    } else
      s.topology = await fetch("/examples/redundant.json").then((r) =>
        r.json(),
      );
  } catch {
    s.topology = await fetch("/examples/redundant.json").then((r) => r.json());
  }
  fixEndpoints();
  route();
  await poll();
  setInterval(poll, 1200);
}
boot().catch((e) => {
  main.innerHTML = `<section class="panel empty-state"><h1>Could not load PacketSim</h1><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></section>`;
});
