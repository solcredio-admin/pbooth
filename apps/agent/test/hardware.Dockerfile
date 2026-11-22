# Test image with the real hardware tools the agent drives: gPhoto2 and CUPS (+ a virtual PDF
# printer). Used by test/hardware.sh. Not for production.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      gphoto2 cups cups-client cups-bsd printer-driver-cups-pdf ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /w
