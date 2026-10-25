// Shared interaction rules keep progress and navigation tied to a real job.
export function simulationFinished(pending, snap) {
  return Boolean(pending && snap.job === pending.job && !snap.busy &&
    snap.phase === "ready" && !snap.error &&
    snap.results.some(r => r.status === "completed" && !pending.before.includes(r.id)));
}
export function progressCopy(snap) {
  const protocol = snap.message?.match(/\b(RIP|OSPF|EIGRP)\b/)?.[1] || snap.lab?.protocol || "Routers";
  const copy = {
    starting: ["Preparing your simulation", "Checking the network and starting a fresh routing experiment."],
    deploying: [`Building the ${protocol} network`, "Creating virtual routers and wiring up your connections."],
    converging: [`${protocol} is learning the paths`, "Routers are exchanging routes. Waiting until their routing tables settle."],
    running: [`${protocol} is sending packets`, snap.live?.failure != null
      ? "The scheduled link is down. Watching routers find another path and measuring delivery."
      : "Sending real UDP packets, recording their journey and measuring delay and delivery."],
    analyzing: [`Reading the ${protocol} captures`, "Matching packet IDs with captured hops and calculating the report."],
  };
  const [title, detail] = copy[snap.phase] || ["Simulation in progress", snap.message || "Waiting for the next routing update."];
  return {title, detail};
}
export function canvasPosition(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX; point.y = clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}
export const devicePosition = (x, y) => ({
  x: Math.round(Math.max(42, Math.min(1058, x))),
  y: Math.round(Math.max(60, Math.min(545, y))),
});
