#!/usr/bin/env bash
#
# Production deploy for the dashboard.
#
# Since switching off `next dev`, code changes are NO LONGER live-on-save — they ship
# through a production build. Run this after editing code to push changes live:
#
#     bash scripts/deploy.sh
#
# It rebuilds the optimized bundle, then restarts the launchd service (which runs
# `next start`). Downtime is only the few seconds of the service restart; the build
# happens against the running server and swaps in atomically on restart.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # -> dashboard/

echo "▶ Building production bundle (this is the slow part)…"
npm run build

echo "▶ Restarting dashboard service…"
launchctl kickstart -k "gui/$(id -u)/com.podcast.dashboard"

echo "✓ Deployed. Live at https://hub.ailanbao.org"
echo "  Logs: tail -f data/logs/dashboard.log"
