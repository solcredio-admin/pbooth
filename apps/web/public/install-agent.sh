#!/usr/bin/env bash
# pbooth agent installer for macOS and Ubuntu. Copy the exact command from the booth page; it looks like:
#   curl -fsSL https://pbooth.example.com/install-agent.sh | bash -s -- https://pbooth.example.com XXXX-XXXX
# Asks for your password (sudo). Safe to run again (updates the agent, re-enrolls with a new code).
set -euo pipefail
SERVER="${1:?usage: install-agent.sh <server-url> <enrollment-code>}"
CODE="${2:?usage: install-agent.sh <server-url> <enrollment-code>}"
step() { printf '\n== %s\n' "$1"; }
has_node24() { node --version 2>/dev/null | grep -q '^v24\.'; }
enroll_failed() { echo "Enrollment failed. Codes work once and last 30 minutes: make a new one on the booth or station page and run the new command." >&2; exit 1; }

if [ "$(uname -s)" = Darwin ]; then
  DIR=/Users/Shared/pbooth-agent
  step "Node.js 24"
  if ! has_node24; then
    V=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v24\.[0-9.]*"' | head -1 | cut -d'"' -f4)
    curl -fsSL "https://nodejs.org/dist/$V/node-$V.pkg" -o /tmp/node.pkg
    sudo installer -pkg /tmp/node.pkg -target /
  fi
  node --version

  step "Download the agent"
  curl -fsSL "$SERVER/agent.zip" -o /tmp/pbooth-agent.zip
  PLIST="$HOME/Library/LaunchAgents/net.pbooth.agent.plist"
  launchctl unload "$PLIST" 2>/dev/null || true
  mkdir -p "$DIR" && unzip -oq /tmp/pbooth-agent.zip -d "$DIR"
  (cd "$DIR" && npm install --omit=dev --no-audit --no-fund)

  step "Connect this computer"
  node "$DIR/dist/main.js" enroll --server "$SERVER" --code "$CODE" || enroll_failed

  step "Start when you log in"
  mkdir -p "$HOME/Library/LaunchAgents"
  # use this Mac's node (nodejs.org installs /usr/local/bin/node, Homebrew /opt/homebrew/bin/node)
  sed "s#<string>/usr/local/bin/node</string>#<string>$(command -v node)</string>#" "$DIR/deploy/net.pbooth.agent.plist" > "$PLIST"
  launchctl load -w "$PLIST"
  sleep 3
  if ! launchctl list net.pbooth.agent 2>/dev/null | grep -q '"PID"'; then
    echo "The agent didn't start. See /tmp/pbooth-agent.log, or run: node $DIR/dist/main.js run" >&2; exit 1
  fi
  node "$DIR/dist/main.js" doctor || true
  echo "Tip: turn on automatic login for this account so the agent starts after a reboot."
else
  DIR=/opt/pbooth-agent
  step "Node.js 24, gPhoto2, CUPS"
  if ! has_node24; then curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -; fi
  sudo apt-get install -y nodejs gphoto2 cups unzip
  node --version

  step "Download the agent"
  curl -fsSL "$SERVER/agent.zip" -o /tmp/pbooth-agent.zip
  sudo systemctl stop pbooth-agent 2>/dev/null || true
  sudo unzip -oq /tmp/pbooth-agent.zip -d "$DIR"
  (cd "$DIR" && sudo npm install --omit=dev --no-audit --no-fund)
  id pbooth >/dev/null 2>&1 || sudo useradd --system --create-home --groups plugdev,lp pbooth
  sudo install -d -o pbooth -g pbooth /var/lib/pbooth-agent
  gio mount -s gphoto2 2>/dev/null || true # stop the desktop from grabbing the camera

  step "Connect this computer"
  sudo -u pbooth PBOOTH_AGENT_DIR=/var/lib/pbooth-agent node "$DIR/dist/main.js" enroll --server "$SERVER" --code "$CODE" || enroll_failed

  step "Start with the computer"
  sed "s#ExecStart=/usr/bin/node #ExecStart=$(command -v node) #" "$DIR/deploy/pbooth-agent.service" | sudo tee /etc/systemd/system/pbooth-agent.service >/dev/null
  sudo systemctl daemon-reload && sudo systemctl enable --now pbooth-agent
  sudo -u pbooth PBOOTH_AGENT_DIR=/var/lib/pbooth-agent node "$DIR/dist/main.js" doctor || true
fi
printf '\nDone. The booth page shows the agent as connected within a minute.\n'
