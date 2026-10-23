#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose down
printf '\nStopped. Experiment results remain in the Docker data volume.\n'
