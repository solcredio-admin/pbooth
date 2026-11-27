#!/usr/bin/env bash
# Builds this checkout as the development stack on Emeruth. Never touches production (project "pbooth").
# Tailnet only: https://pbooth-dev.ts.solcredio.net (see infra/pbooth-dev.compose.yaml).
set -euo pipefail
cd "$(dirname "$0")/.."
D=compose/pbooth-dev
ssh emeruth "mkdir -p ~/$D/src"
rsync -az --delete --exclude node_modules --exclude .next --exclude dist --exclude apps/api/src/generated --exclude .git --exclude '.env' \
  --exclude '.sim-booth*' --exclude test-results --exclude .claude --exclude graphify-out --exclude .impeccable ./ "emeruth:$D/src/"
rsync -az infra/pbooth-dev.compose.yaml "emeruth:$D/compose.yaml"
ssh emeruth "cd ~/$D && docker compose up -d --build --wait"
