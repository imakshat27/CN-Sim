# EC2 deployment

Run on a dedicated Ubuntu 24.04 EC2 instance. The lab requires privileged Docker;
do not share its host with sensitive workloads. One deployment has one shared lab.

Use a t3.small and 20 GiB gp3 disk initially. Allow TCP 22 only from your IP and
TCP 80/443 for the HTTPS gateway. Port 8000 remains bound to loopback. Require
IMDSv2 and set its response hop limit to 1 so the lab cannot reach instance
credentials. This app does not need an IAM instance role. Use standard CPU credits
to prevent surplus-credit charges. Never put GitHub tokens in EC2 user data.
Record the instance type and CPU credit state with academic measurements: shared
cloud hosts and exhausted burst credits can affect observed latency and timing.

Install Docker Engine with Compose from Docker's official Ubuntu repository.
Copy the repository into `/opt/cn-sim`, without `.git`, local results, or secrets.

Create `.env` (permissions 600) containing:

```dotenv
CN_SIM_DOMAIN=packetsim.imakshat.com
CN_SIM_USER=akshat
CN_SIM_PASSWORD_HASH='$2a$...bcrypt hash...'
```

Generate a strong password and its bcrypt hash using Caddy's `hash-password`
command; store the plaintext only in the owner's password manager. Single quotes
in `.env` preserve the dollar signs in bcrypt hashes. Do not commit credentials.
For a high-entropy generated password, bcrypt cost 10 avoids excessive per-request
authentication work on a small demonstration instance.

```sh
docker compose -f compose.yaml -f compose.production.yaml up -d --build --wait
```

Create a Cloudflare A record named `packetsim` pointing at this instance's public
IPv4. Caddy obtains and renews a trusted certificate automatically. If using
Cloudflare proxying, use Full (strict) encryption and ensure port 80 certificate
validation reaches Caddy. Do not change the zone-wide TLS mode if other services
depend on it; use a hostname-specific configuration or DNS-only record instead.
Do not add cache rules for the simulator or its API. The login protects all pages,
API routes, reports, and captures. Use a separate browser profile to test access.

Validate the deployed site rejects requests without credentials, accepts valid
credentials, rejects foreign origins and untrusted hosts, runs an actual routing
experiment, and exports its JSON/CSV/PCAP. Backend traffic inside the Docker
network does not need to trust arbitrary forwarded headers: the production
configuration explicitly sets the allowed public origin to the HTTPS domain.
Compose keeps the backend private except for host loopback.

The default EC2 public IPv4 may change after stop/start. Update the DNS record
when that happens; a reboot retains it. Results and Caddy certificates persist in
Docker volumes. To update, copy a new source release and rerun the Compose command.
To stop compute costs, stop the instance in EC2; EBS storage still incurs charges.
Keep a source/result backup locally before terminating the instance or its disk.

Run `python3 tests/deployment_smoke.py` locally to exercise the gateway with an
isolated disposable password and containers before deployment.
