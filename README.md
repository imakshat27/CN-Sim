# CN-Sim

A custom web interface for comparative routing experiments, backed by real FRRouting processes and Linux packet forwarding.

## Current state: backend feasibility verified

The executable proof creates three isolated router network namespaces inside a disposable Docker container, connects them with virtual Ethernet pairs, starts Zebra plus the selected routing daemon, waits for a dynamically learned remote loopback route, and sends real ICMP echo requests across the network. It repeats this independently for RIP, OSPF, and EIGRP, then removes the namespaces and processes.

This is a backend feasibility check, not a completed web application. `dist/engine.js` is an earlier educational browser simulation prototype; it is not used to produce the real-backend test results.

From this directory:

```sh
docker compose up --build --abort-on-container-exit --exit-code-from lab
docker compose down
```

Docker Desktop must be running on macOS. The container needs privileged mode to create isolated Linux network namespaces and virtual links. The proof does not need external ports, host networking, or the Docker socket. All router interfaces are inside the disposable container. FRRouting is the Debian Bookworm package (8.4.4 on the tested build); this is an open-source implementation, not Cisco IOS.

The commands print one JSON record per protocol with the learned routing table and a pass/fail result. A failure exits nonzero. Recorded local results are in `tests/feasibility-results.jsonl`.

These startup timings are **not protocol comparison measurements**: the proof uses a small chain, sequential daemon startup, and OSPF hello/dead intervals of 1/4 seconds to keep the test short. Performance experiments will record the complete timer configuration and use repeated trials.

## Selected application architecture

```text
Custom browser frontend
  topology editor · packet timeline · charts · circular report scores
             |
       HTTP API + live event stream
             |
Python experiment controller (inside the Linux lab container)
  validation · topology lifecycle · addressing · measurements · export
             |
Linux namespaces + virtual Ethernet + tc/netem
             |
FRRouting: zebra + ripd / ospfd / eigrpd
```

A Linux namespace gives each virtual router its own interfaces, routes, and network stack. FRRouting exchanges actual routing protocol packets, while the Linux kernel forwards traffic. One Docker service can contain the controller and all router namespaces; there is no need for a separate VM or container per router.

The frontend will be purpose-built for this project. No third-party emulator's interface is required. A drawing is sent as validated topology JSON; the controller turns it into links and router configurations. UI connection controls map to Linux interface state, rate limits, and delay settings.

## Implementation sequence

1. Extend the proof into a lifecycle API: create/delete topology, select protocol, inspect routes and neighbors, start/stop experiments.
2. Add real probes: ping for RTT/loss, iperf3 for throughput and UDP jitter/loss, traceroute and captures for packet inspection.
3. Implement controlled link failures and route-table sampling. Track route convergence separately from traffic recovery; include the polling interval as measurement uncertainty.
4. Build the custom white frontend: draggable devices, editable links, live event log, hop traces, graphs, and router inspection.
5. Compare protocols sequentially on the same topology, traffic settings, failure scenario, and timer policy. Store raw observations, FRR version, host details, and repeated-trial statistics.
6. Generate a report with raw measurements, CSV/JSON export, and green/yellow/red circular indicators. Composite scores must show their formula, targets, and weights; they are project-defined scores, not standard protocol efficiency percentages.

## Measurement rules

- Ping measures round-trip time; do not call half the RTT a measured one-way delay.
- A traceroute is a separate diagnostic probe. Animation reconstructed from it is not proof that every application packet took that exact path.
- Packet-level traces require actual capture/correlation. Distinguish captured observations from inferred topology paths.
- Count control traffic at one defined boundary (for example, egress on each inter-router link) to avoid counting the same transmission twice.
- Report startup convergence, failure detection, routing-table convergence, and data-plane recovery separately.
- Make timer choices explicit. Do not silently accelerate one protocol's timers and describe the results as defaults.
- Virtualization and shared CPU scheduling affect results. Report these as software routing measurements on the test machine, not physical Cisco router benchmarks.
- Validate EIGRP recovery behavior on redundant topologies before relying on it for the final comparison. The chain proof establishes adjacency, route learning, and forwarding only.

## References

- [FRRouting EIGRP](https://docs.frrouting.org/en/latest/eigrpd.html)
- [FRRouting RIP](https://docs.frrouting.org/en/latest/ripd.html)
- [FRRouting OSPF](https://docs.frrouting.org/en/latest/ospfd.html)
- [Linux network namespaces](https://man7.org/linux/man-pages/man8/ip-netns.8.html)
