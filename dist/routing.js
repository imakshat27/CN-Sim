import { esc } from "./ui.js?v=20261025-2";

// Historical inspection must never read the currently deployed lab's tables.
export function routingPopover(run, id) {
  const node = run?.topology.nodes.find(node => node.id === id && node.type === "router");
  if (!node) return "";
  const saved = run.routingTables?.[id];
  const header = `<header><div><strong>${esc(id)} · ${esc(run.protocol)} routing table</strong><p>Trial ${esc(run.trial)} · end of the selected run</p></div><button class="btn small ghost" data-action="close-routing-popover" aria-label="Close routing table">×</button></header>`;
  const context = `<p class="routing-context">This is the recorded table after this simulation finished. It may differ from the table when an earlier packet was sent.</p>`;
  if (saved?.protocol === run.protocol && saved.text) {
    return header + context + `<div class="routing-scroll" tabindex="0" aria-label="Recorded ${esc(run.protocol)} routing table for ${esc(id)}"><pre>${esc(saved.text)}</pre></div><p class="routing-foot">FRRouting table · [administrative distance / protocol metric]. Connected routes appear alongside ${esc(run.protocol)} routes.</p>`;
  }
  const routes = run.routes?.[id];
  if (!routes?.length) return header + `<p class="routing-context">No routing table was recorded for this router in this run.</p>`;
  const rows = routes.flatMap(route => (route.nexthops?.length ? route.nexthops : [route]).map(hop =>
    `<tr><td>${esc(route.dst || "default")}</td><td>${esc(hop.gateway || route.gateway || "Directly connected")}</td><td>${esc(hop.dev || route.dev || "—")}</td><td>${esc(route.protocol || "kernel")}</td></tr>`));
  return header + context + `<p class="routing-legacy">Only the Linux forwarding table is available for this run. Protocol metrics were not recorded; the Linux route priority is not the ${esc(run.protocol)} metric. Run a new simulation to save the full FRRouting table.</p><div class="routing-scroll" tabindex="0" aria-label="Recorded forwarding table for ${esc(id)}"><table><thead><tr><th>Destination</th><th>Next hop</th><th>Interface</th><th>Learned by</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
