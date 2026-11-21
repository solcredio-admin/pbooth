#!/usr/bin/env bash
# Adds pbooth.solcredio.net to Veldora's Caddy (public reverse proxy → Stravex over Tailscale).
# Backs up the Caddyfile, appends the block once, validates, then reloads. Asks for your sudo password.
set -euo pipefail
ssh -t veldora 'set -e
F=/etc/caddy/Caddyfile
if sudo grep -q "^pbooth.solcredio.net" "$F"; then echo "Route already present."; exit 0; fi
sudo cp "$F" "$F.bak-$(date +%Y%m%d-%H%M)-pbooth"
printf "\n############################################\n\npbooth.solcredio.net {\n\timport access_log\n\treverse_proxy 100.86.234.119:3310\n}\n" | sudo tee -a "$F" >/dev/null
sudo caddy validate --config "$F" --adapter caddyfile
sudo systemctl reload caddy
echo "pbooth.solcredio.net is routed. Caddy will fetch its certificate on the first request."'
