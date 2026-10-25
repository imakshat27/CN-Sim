import { esc } from "./ui.js?v=20261026-3";

const routerIds = (run) =>
  new Map(run.topology.nodes.map((node, index) => [`10.255.0.${index + 1}`, node]));
const peerFor = (run, address) => {
  for (const [index, link] of run.topology.links.entries()) {
    const prefix = `10.0.${index + 1}.`;
    if (address === prefix + "1") return link.b;
    if (address === prefix + "2") return link.a;
  }
  return address || "Directly connected";
};
const nativeRows = (run, id, text) => {
  const routers = routerIds(run), rows = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*[ROE][^\s]*\s+(10\.255\.0\.\d+)\/32\s+\[\d+\/(\d+)\](?:\s+via\s+(\d+\.\d+\.\d+\.\d+))?/);
    if (!match) continue;
    const destination = routers.get(match[1]);
    if (destination?.type === "router" && destination.id !== id)
      rows.push({ router: destination.id, cost: match[2], nextHop: peerFor(run, match[3]) });
  }
  return rows;
};
const fallbackRows = (run, id, routes) => {
  const routers = routerIds(run);
  return routes.filter((route) => /^10\.255\.0\.\d+\/32$/.test(route.dst || "")).flatMap((route) => (route.nexthops?.length ? route.nexthops : [route]).map((hop) => ({ router: routers.get((route.dst || "").split("/")[0])?.id, cost: "—", nextHop: peerFor(run, hop.gateway || route.gateway) }))).filter((row) => row.router && row.router !== id);
};

// Historical inspection only reads state saved with the selected run.
export function routingPopover(run, id) {
  const node = run?.topology.nodes.find((node) => node.id === id && node.type === "router");
  if (!node) return "";
  const saved = run.routingTables?.[id];
  const rows = saved?.protocol === run.protocol && saved.text ? nativeRows(run, id, saved.text) : fallbackRows(run, id, run.routes?.[id] || []);
  const header = `<header><div><strong>${esc(id)} · ${esc(run.protocol)} routes</strong><p>Trial ${esc(run.trial)} · recorded at the end of this run</p></div><button class="btn small ghost" data-action="close-routing-popover" aria-label="Close routing table">×</button></header>`;
  if (!rows.length) return header + `<p class="routing-context">No remote-router route was recorded for this router in the selected run.</p>`;
  return header + `<div class="routing-simple"><table aria-label="${esc(run.protocol)} routes from ${esc(id)}"><thead><tr><th>Router</th><th>Cost</th><th>Next hop</th></tr></thead><tbody>${rows.map((row) => `<tr><td><span class="routing-router">${esc(row.router)}</span></td><td class="routing-cost">${esc(row.cost)}</td><td>${esc(row.nextHop)}</td></tr>`).join("")}</tbody></table></div><p class="routing-foot">Cost is the native ${esc(run.protocol)} metric for this route.</p>`;
}
