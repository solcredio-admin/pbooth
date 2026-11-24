#!/usr/bin/env bash
# Builds this checkout as the development stack on Stravex. Never touches production (project "pbooth").
set -euo pipefail
cd "$(dirname "$0")/.."
D=compose/pbooth-dev
ssh stravex "mkdir -p ~/$D/src"
rsync -az --exclude node_modules --exclude .next --exclude dist --exclude apps/api/src/generated --exclude .git --exclude '.env' \
  --exclude '.sim-booth*' --exclude test-results --exclude .claude --exclude graphify-out ./ "stravex:$D/src/"
rsync -az infra/pbooth-dev.compose.yaml "stravex:$D/compose.yaml"
ssh stravex "cd ~/$D && docker compose up -d --build --wait"
