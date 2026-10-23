"""Initialize a new host's gateway settings without putting secrets in argv.

Run with sudo on the deployment host, from the repository root. The one-time
password is saved to .deployment-login (mode 600); configuration is never replaced.
"""

import argparse
import os
from pathlib import Path
import re
import secrets
import subprocess


parser = argparse.ArgumentParser()
parser.add_argument("--domain", default="packetsim.imakshat.com")
parser.add_argument("--user", default="akshat")
args = parser.parse_args()
if not re.fullmatch(r"[a-zA-Z0-9.-]+", args.domain) or "." not in args.domain:
    parser.error("Use a DNS hostname")
if not re.fullmatch(r"[a-zA-Z0-9_-]+", args.user):
    parser.error("Use an alphanumeric username")
os.umask(0o077)
settings, credentials = Path(".env"), Path(".deployment-login")
if settings.exists() or credentials.exists():
    raise SystemExit("Existing gateway settings or credentials found; nothing changed")
password = secrets.token_urlsafe(24)
hashed = subprocess.check_output(
    ["docker", "run", "--rm", "-i", "caddy:2.10.2-alpine", "caddy",
     "hash-password", "--bcrypt-cost", "10"],
    input=password + "\n", text=True,
).strip()
if not hashed.startswith("$2a$10$") and not hashed.startswith("$2b$10$"):
    raise SystemExit("Unexpected password hash format")
with credentials.open("x") as output:
    output.write(f"URL: https://{args.domain}\nUsername: {args.user}\nPassword: {password}\n")
with settings.open("x") as output:
    output.write(f"CN_SIM_DOMAIN={args.domain}\nCN_SIM_USER={args.user}\n")
    output.write(f"CN_SIM_PASSWORD_HASH='{hashed}'\n")
print("Gateway configured. Initial login is in .deployment-login (mode 600).")
