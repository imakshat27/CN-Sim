#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! docker info >/dev/null 2>&1; then
  echo 'Docker is not running. Open Docker Desktop, wait until it is ready, and rerun ./start.sh.' >&2
  exit 1
fi
docker compose up -d --build --wait
printf '\nCN-Sim is ready: http://127.0.0.1:8000\n'
