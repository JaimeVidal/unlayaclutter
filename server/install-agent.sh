#!/usr/bin/env bash
# Install (or remove) a launchd agent that keeps the Laya server running for your login session.
#
#   ./server/install-agent.sh            install and start
#   ./server/install-agent.sh uninstall  stop and remove
set -euo pipefail

LABEL="dev.unclutter.laya-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$REPO/server/.venv/bin/python"
SCRIPT="$REPO/server/laya_server.py"
LOG="$HOME/Library/Logs/laya-unclutter.log"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. The server is stopped and will not start at login."
  exit 0
fi

[ -x "$PYTHON" ] || { echo "Missing $PYTHON — run 'npm run server:setup' first." >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$SCRIPT</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/server</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

printf 'Waiting for the model to load'
for _ in $(seq 1 90); do
  if curl -fsS -m 2 http://127.0.0.1:8765/health >/dev/null 2>&1; then
    echo; echo "Ready. $(curl -fsS http://127.0.0.1:8765/health)"
    echo "Log: $LOG"
    exit 0
  fi
  printf '.'; sleep 2
done
echo; echo "Timed out. Check $LOG" >&2; exit 1
