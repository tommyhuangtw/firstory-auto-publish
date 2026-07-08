#!/usr/bin/env bash
# Pull latest main and redeploy the dashboard on THIS host machine
# (the one whose Cloudflare tunnel serves hub.ailanbao.org -> localhost:3000).
#
# Safe order: build first, only restart the service if the build succeeds,
# so a broken build never takes the live site down.
#
# Usage:  ./redeploy-local.sh
set -euo pipefail

REPO="/Users/slowbster/Desktop/firstory-auto-publish"
SERVICE="com.podcast.dashboard"
cd "$REPO"

echo "▶ Pulling latest main…"
git checkout main
git pull --ff-only

cd dashboard

# Reinstall deps only when the lockfile actually changed in this pull.
if ! git diff --quiet HEAD@{1} HEAD -- package-lock.json 2>/dev/null; then
  echo "▶ package-lock.json changed → npm install"
  npm install
else
  echo "▶ deps unchanged → skip npm install"
fi

echo "▶ Building (live site stays on old build until this succeeds)…"
npm run build

echo "▶ Restarting ${SERVICE}…"
launchctl kickstart -k "gui/$(id -u)/${SERVICE}"

echo "▶ Waiting for server to come up…"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "✅ Deployed — localhost:3000 healthy (HTTP 200) at $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "⚠️  Server did not return 200 within 30s — check: launchctl list | grep $SERVICE"
exit 1
