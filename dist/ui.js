export const icons = {
  network:
    '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M7 5h10M6 7l5 10m7-10l-5 10"/>',
  chart: '<path d="M4 4v16h17M8 15v-4m5 4V7m5 8v-7"/>',
  trace:
    '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h4"/>',
  report:
    '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8m-8 4h5"/>',
  book: '<path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1zm0 0v15"/>',
  router:
    '<path d="M4 12h16M8 8l-4 4 4 4m8-8l4 4-4 4M12 4v16m-3-13 3-3 3 3m-6 10 3 3 3-3"/>',
  host: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  cursor: '<path d="m5 3 14 9-6 1-3 7z"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  folder: '<path d="M3 7V5h6l3 3h9v12H3z"/>',
  undo: '<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  packet: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v9M8 5l9 5"/>',
  activity: '<path d="M2 12h5l3-9 4 18 3-9h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  print: '<path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7zm10-3h1"/>',
};
export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
export const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (n, d = 2) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
export const bytes = (n) =>
  n >= 1e6
    ? fmt(n / 1e6, 2) + " MB"
    : n >= 1000
      ? fmt(n / 1000, 1) + " kB"
      : fmt(n, 0) + " B";
export const color = (score) =>
  score >= 80 ? "green" : score >= 60 ? "amber" : "red";
export const btn = (label, action, ic = "", classes = "", attrs = "") =>
  `<button class="btn ${classes}" data-action="${action}" ${attrs}>${ic ? icon(ic) : ""}${label}</button>`;
export const panel = (title, body, right = "", classes = "") =>
  `<section class="panel ${classes}"><div class="panel-title"><h2>${title}</h2>${right}</div>${body}</section>`;
export function field(label, name, value, options = {}) {
  const {
    type = "number",
    min,
    max,
    step,
    help,
    choices,
    disabled = false,
  } = options;
  const attrs = `id="cfg-${name}" data-config="${name}" ${disabled ? "disabled" : ""}`;
  return `<div class="field"><label for="cfg-${name}">${label}</label>${choices ? `<select ${attrs}>${choices.map(([val, text]) => `<option value="${esc(val)}" ${String(val) === String(value) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>` : `<input ${attrs} type="${type}" value="${esc(value)}" ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} ${step ? `step="${step}"` : ""}>`}${help ? `<div class="field-help">${help}</div>` : ""}</div>`;
}
export function chart(runs, metric, title, unit) {
  const colors = { RIP: "#bc8e41", OSPF: "#4b79a9", EIGRP: "#168b7d" };
  const width = 500,
    height = 185,
    pad = { l: 43, r: 12, t: 10, b: 28 };
  const valid = runs.filter((r) => r.bins?.length);
  const maxX = Math.max(1, ...valid.map((r) => r.config.duration));
  const values = valid.flatMap((r) =>
    r.bins.map((b) => b[metric]).filter((v) => v !== null),
  );
  const maxY = Math.max(metric === "throughput" ? 0.01 : 1, ...values) * 1.15;
  const x = (t) => pad.l + (t / maxX) * (width - pad.l - pad.r),
    y = (v) => height - pad.b - (v / maxY) * (height - pad.t - pad.b);
  let grid = "";
  for (let i = 0; i < 5; i++) {
    const value = (maxY * i) / 4;
    grid += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(value)}" y2="${y(value)}" stroke="#edf1f4"/><text x="${pad.l - 9}" y="${y(value) + 3}" text-anchor="end" font-size="8" fill="#97a5af" font-family="monospace">${fmt(value, metric === "throughput" ? 2 : 0)}</text>`;
  }
  for (let i = 0; i < 5; i++) {
    const v = (maxX * i) / 4;
    grid += `<text x="${x(v)}" y="${height - 8}" text-anchor="middle" font-size="8" fill="#97a5af" font-family="monospace">${fmt(v, 0)}s</text>`;
  }
  const paths = valid
    .map((r) => {
      let path = "",
        open = false;
      for (const b of r.bins) {
        if (b[metric] === null) {
          open = false;
          continue;
        }
        path += `${open ? "L" : "M"}${x(b.time).toFixed(1)},${y(b[metric]).toFixed(1)} `;
        open = true;
      }
      return `<path d="${path}" fill="none" stroke="${colors[r.protocol]}" stroke-width="2" stroke-linejoin="round"/>${r.failureAt !== null ? `<line x1="${x(r.failureAt)}" x2="${x(r.failureAt)}" y1="${pad.t}" y2="${height - pad.b}" stroke="#da9a9c" stroke-dasharray="3 4"/>` : ""}`;
    })
    .join("");
  return panel(
    title,
    `<div class="chart-body"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} in ${unit} by send-time cohort. Dashed red line marks link failure.">${grid}${paths}</svg><div class="chart-legend">${[...new Set(valid.map((r) => r.protocol))].map((p) => `<span><i style="background:${colors[p]}"></i>${p}</span>`).join("")}</div></div>`,
    `<span class="tag">${unit}</span>`,
  );
}
export function scores(m, failure) {
  const convergence = failure ? m.routeConvergence : m.initialConvergence;
  const delivery = m.delivery || 0,
    latency = m.meanDelay === null ? 0 : 100 / (1 + m.meanDelay / 50),
    conv = convergence === null ? 0 : 100 / (1 + convergence / 2),
    overhead = m.dataBytes
      ? (100 * m.dataBytes) / (m.dataBytes + m.controlBytes)
      : 0;
  return {
    delivery,
    latency,
    convergence: conv,
    overhead,
    total: 0.4 * delivery + 0.2 * latency + 0.25 * conv + 0.15 * overhead,
  };
}
export function ring(value, label = "PROJECT SCORE") {
  const v = Math.max(0, Math.min(100, value));
  return `<div class="ring ${color(v)}" role="img" aria-label="${fmt(v, 0)} percent ${label}"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="value" cx="60" cy="60" r="52" stroke-dasharray="326.73" stroke-dashoffset="${326.73 * (1 - v / 100)}"/></svg><div class="ring-text">${fmt(v, 0)}<small>${label}</small></div></div>`;
}
export function topologySVG(
  topology,
  {
    selected = null,
    live = null,
    trace = null,
    zoom = 1,
    editable = true,
  } = {},
) {
  const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
  const pathNodes = trace
    ? [
        ...trace.hops.map((h) => h.node),
        ...(trace.status === "delivered" ? [trace.destination] : []),
      ]
    : [];
  let elements = "";
  for (const l of topology.links) {
    const a = nodes.get(l.a),
      b = nodes.get(l.b);
    if (!a || !b) continue;
    const runtime = live?.links?.[l.id];
    const up = runtime ? runtime.up : l.up;
    const selectedLink = selected?.kind === "link" && selected.id === l.id;
    const highlight = pathNodes.some(
      (p, i) =>
        i &&
        ((p === l.a && pathNodes[i - 1] === l.b) ||
          (p === l.b && pathNodes[i - 1] === l.a)),
    );
    const midx = (a.x + b.x) / 2,
      midy = (a.y + b.y) / 2;
    elements += `<g data-link="${esc(l.id)}"><line class="link-line ${!up ? "down" : ""} ${highlight || selectedLink ? "highlight" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><line class="link-hit" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><rect class="link-label-bg" x="${midx - 36}" y="${midy - 9}" width="72" height="18" rx="4"/><text class="link-label" x="${midx}" y="${midy + 3}" text-anchor="middle">${l.bandwidth} Mbps</text></g>`;
  }
  for (const n of topology.nodes) {
    const selectedNode = selected?.kind === "node" && selected.id === n.id;
    const glyph =
      n.type === "router"
        ? `<path d="M-15 0h30m-10-5 5 5-5 5M-5-5l-5 5 5 5M0-15v30m-5-10 5 5 5-5m-10-10 5-5 5 5"/>`
        : `<rect x="-16" y="-12" width="32" height="23" rx="2"/><path d="M-8 17h16M0 11v6"/>`;
    const address = live?.nodes?.[n.id]?.ip;
    elements += `<g class="node ${n.type} ${selectedNode ? "selected" : ""}" data-node="${esc(n.id)}" transform="translate(${n.x} ${n.y})" role="button" tabindex="0" aria-label="${esc(n.id)} ${n.type}">${n.type === "router" ? '<circle class="shape" r="31"/>' : '<rect class="shape" x="-31" y="-28" width="62" height="56" rx="9"/>'}<g class="glyph">${glyph}</g><circle class="node-indicator ${!address ? "idle" : ""}" cx="24" cy="-22" r="4.5"/><text class="node-label" text-anchor="middle" y="49">${esc(n.id)}</text><text class="node-sub" text-anchor="middle" y="63">${address || (n.type === "router" ? "ROUTER" : "END HOST")}</text></g>`;
  }
  if (trace && pathNodes.length > 1) {
    let path = pathNodes
      .map((n) => nodes.get(n))
      .filter(Boolean)
      .map((n, i) => `${i ? "L" : "M"}${n.x} ${n.y}`)
      .join(" ");
    elements += `<circle r="5" fill="#0b7970" stroke="white" stroke-width="2"><animateMotion dur="4s" repeatCount="indefinite" path="${path}"/></circle>`;
  }
  return elements;
}
