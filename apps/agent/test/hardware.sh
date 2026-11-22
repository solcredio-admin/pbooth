#!/bin/sh
# Runs inside test/hardware.Dockerfile with the repo mounted at /src.
set -e
cp -r /src /w/repo && cd /w/repo
pnpm install --frozen-lockfile --filter @pbooth/agent >/dev/null 2>&1
cupsd
for i in 1 2 3 4 5 6 7 8 9 10; do lpstat -r >/dev/null 2>&1 && break; sleep 1; done
PPD=$(find /usr/share/ppd -iname 'CUPS-PDF_opt.ppd*' | head -1)
lpadmin -p PDF -E -v cups-pdf:/ -P "$PPD"
lpadmin -d PDF
cd apps/agent && HARDWARE_INTEGRATION=1 npx vitest run 2>&1
