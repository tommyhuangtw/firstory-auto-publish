#!/bin/bash
# Install/uninstall orchestrator launchd jobs
# Usage:
#   ./install-cron.sh install   — load both morning + evening jobs
#   ./install-cron.sh uninstall — unload and remove both jobs

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLISTS=("com.podcast.orchestrator.morning" "com.podcast.orchestrator.evening")

# Ensure logs directory exists
mkdir -p "$SCRIPT_DIR/../data/logs"

case "${1:-install}" in
  install)
    mkdir -p "$LAUNCH_AGENTS"
    for name in "${PLISTS[@]}"; do
      src="$SCRIPT_DIR/$name.plist"
      dst="$LAUNCH_AGENTS/$name.plist"

      # Unload if already loaded
      launchctl list "$name" 2>/dev/null && launchctl unload "$dst" 2>/dev/null || true

      cp "$src" "$dst"
      launchctl load "$dst"
      echo "✓ Loaded $name"
    done
    echo ""
    echo "Orchestrator cron installed:"
    echo "  Morning (08:00) — review leftovers + send 老闆快報 (the one daily boss touchpoint)"
    echo "  Evening (20:00) — propose + evaluate + execute + review (silent)"
    echo ""
    echo "Check status: launchctl list | grep podcast"
    echo "View logs:    tail -f dashboard/data/logs/orchestrator-*.log"
    ;;

  uninstall)
    for name in "${PLISTS[@]}"; do
      dst="$LAUNCH_AGENTS/$name.plist"
      if [ -f "$dst" ]; then
        launchctl unload "$dst" 2>/dev/null || true
        rm "$dst"
        echo "✓ Unloaded $name"
      else
        echo "  $name not installed, skipping"
      fi
    done
    echo "Orchestrator cron removed."
    ;;

  *)
    echo "Usage: $0 [install|uninstall]"
    exit 1
    ;;
esac
