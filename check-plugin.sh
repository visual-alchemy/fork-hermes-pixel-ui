#!/bin/bash
set -u

# Safe diagnostic for pixel-ui-bridge. It avoids printing local plugin files,
# Hermes source files, git history, or any user-specific absolute paths.
PLUGIN_DIR="${HERMES_PLUGIN_DIR:-$HOME/.hermes/plugins/pixel-ui-bridge}"
BACKEND_URL="${PIXEL_UI_BACKEND_URL:-http://localhost:9000}"

echo "=== 1) Plugin files ==="
if [ -d "$PLUGIN_DIR" ]; then
  echo "Plugin directory: present"
else
  echo "Plugin directory: missing"
fi

for f in plugin.yaml __init__.py; do
  if [ -f "$PLUGIN_DIR/$f" ]; then
    echo "$f: present"
  else
    echo "$f: missing"
  fi
done

echo ""
echo "=== 2) Backend status ==="
curl -s "$BACKEND_URL/api/status" | python3 -m json.tool 2>&1 | head -30

echo ""
echo "=== 3) Endpoint probe ==="
curl -s -X POST "$BACKEND_URL/api/hermes-event" \
  -H "Content-Type: application/json" \
  -d '{"event":"tool_start","tool_name":"probe","session_id":"diag_test"}'
echo ""
echo "If the endpoint returns ok=true, Pixel UI is reachable."
