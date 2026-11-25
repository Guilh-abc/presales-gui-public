#!/bin/bash
set -euo pipefail
# Uso: SYNC_TOKEN='...' API='https://presales-kanzo....workers.dev' bash install_mac_agent.sh
# Não ecoa o token.
CFG="$HOME/.config/presales-kanzo"
LAUNCH="$HOME/Library/LaunchAgents/com.guilherme.presales-kanzo-sync.plist"
AGENT_DST="$CFG/presales_sync_agent.py"
mkdir -p "$CFG" "$HOME/Library/LaunchAgents" "$HOME/kanzo/backups/presales-sync"
umask 077
if [[ -z "${SYNC_TOKEN:-}" ]]; then echo "SYNC_TOKEN required" >&2; exit 1; fi
printf '%s\n' "$SYNC_TOKEN" > "$CFG/sync-token"
chmod 600 "$CFG/sync-token"
# Prefer Keychain if security available
if command -v security >/dev/null 2>&1; then
  security delete-generic-password -s 'presales-kanzo-sync-token' -a "$USER" >/dev/null 2>&1 || true
  security add-generic-password -s 'presales-kanzo-sync-token' -a "$USER" -w "$SYNC_TOKEN" >/dev/null
fi
cp -f "$(dirname "$0")/presales_sync_agent.py" "$AGENT_DST"
chmod 700 "$AGENT_DST"
API_URL="${API:-https://SEU-WORKER.SUA-CONTA.workers.dev}"
cat > "$LAUNCH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.guilherme.presales-kanzo-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$AGENT_DST</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PRESALES_API</key><string>$API_URL</string>
    <key>PRESALES_SYNC_INTERVAL</key><string>8</string>
    <key>KANZO_BIN</key><string>$HOME/.local/bin/kanzo</string>
    <key>KANZO_HOME</key><string>$HOME/kanzo</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$CFG/launch.out.log</string>
  <key>StandardErrorPath</key><string>$CFG/launch.err.log</string>
</dict></plist>
PLIST
launchctl unload "$LAUNCH" >/dev/null 2>&1 || true
launchctl load "$LAUNCH"
# one-shot verify without printing token
PRESALES_API="$API_URL" /usr/bin/python3 "$AGENT_DST" once
echo "LaunchAgent instalado: $LAUNCH"
echo "Logs: $CFG/sync.log"
