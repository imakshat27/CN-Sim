# Interpretation and implementation limits

## FRRouting EIGRP failure recovery

The application uses the real `eigrpd` implementation in FRRouting 10.7.1 (pinned official Debian package), with the original protocol code. It does not replace EIGRP with an estimated algorithm or patch the daemon to produce a preferred outcome.

On the tested ARM64 Linux/Docker environment, EIGRP established adjacencies, learned remote routes, honored interface metric configuration, and delivered steady-state probes. On the bundled redundant topology, an administrative failure of R2–R4 (L3) left stale EIGRP successors at R2/R4. On an x86-64 CI runner, the failure case also caused an EIGRP process to exit; the application records and warns about process exits. Packet forwarding on the previously preferred path did not recover during the tested observation window, even though a graph path still existed. The application recorded the resulting loss and left unobserved route convergence/recovery unavailable.

FRR 8.4.4 was also tested during development; it exhibited incomplete routing-domain recovery on that topology. Updating to 10.7.1 did not resolve the issue. This establishes a limit of these tested implementations/configurations; it does not establish that the EIGRP protocol or Cisco IOS behaves the same way.

Affected current runs include a visible warning and raw route snapshots. **Do not present their circular scores as a general ranking of the RIP, OSPF and EIGRP protocol specifications.** A defensible report can compare steady-state behavior and separately describe this implementation-specific failure outcome. General EIGRP failover claims require a validated implementation and additional experiments.

Relevant upstream source for independent review: [neighbor removal](https://github.com/FRRouting/frr/blob/frr-10.7.1/eigrpd/eigrp_neighbor.c), [topology updates](https://github.com/FRRouting/frr/blob/frr-10.7.1/eigrpd/eigrp_topology.c). The stale routes were observed directly; a complete upstream root-cause analysis or independently verified protocol fix is outside this application.

## Other limits

- IPv4 only; one OSPF area, one EIGRP AS, RIPv2, point-to-point Ethernet links, and single-homed end hosts.
- A maximum of 20 devices, 40 links, 120 seconds per traffic trial, and 100 probes/s keeps local experiments bounded.
- All routers share a Linux kernel and the host's CPU resources. This is software-routing emulation, not physical-router benchmarking.
- Route changes are sampled approximately every 0.5 seconds. Readiness detects route presence and stability, not proof of correctness of every possible forwarding path. Trace and packet delivery provide independent evidence for the chosen flow.
- Administrative link-down is a carrier-loss scenario. It does not model a silent neighbor or optical failure with delayed detection.
- tc/netem delay/rate/loss settings are per direction. Loss is stochastic; input configurations can be repeated, but exact random packet losses are not seeded.
- Packet captures use 128-byte snapshots and a 200,000-frame limit per device. If a capture reaches the limit, the report warns that its hop/overhead observations may be incomplete. Full payload inspection is not provided.
- UDP delivery allows a two-second drain window; later arrivals are counted as missing. Echo RTT may be unavailable even when forward delivery succeeds.
- Scores use explicitly chosen targets and weights. They do not represent a standardized protocol efficiency measure.
- Server restart preserves completed results and captures in the Docker volume, but removes the live virtual network. Draft topology/settings are browser-local.
