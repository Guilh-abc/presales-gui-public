#!/usr/bin/env bash
# Comando único de testes do presales-kanzo. Uso: scripts/test.sh [--bundle]
#   1) regera assets.js a partir de public/ e confere
#   2) testes Node (Worker com D1 simulado, API golden, paridade de formatação, CSP, front)
#   3) testes Python do delete_guard do Mac
#   --bundle: também gera o bundle do wrangler (dry-run, sem publicar) e roda a API golden contra ele
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== 1/3 assets"; node scripts/gerar-assets.mjs && node scripts/gerar-assets.mjs --check
echo "== 2/3 node --test"; node --test tests/*.mjs
echo "== 3/3 delete_guard (Python)"; python3 tests/delete_guard.test.py
if [[ "${1:-}" == "--bundle" ]]; then
  out=$(mktemp -d); echo "== bundle (dry-run em $out)"
  npx --yes wrangler@4 deploy --dry-run --outdir "$out" < /dev/null > "$out/log.txt" 2>&1 || { cat "$out/log.txt"; exit 1; }
fi
echo "OK: todos os testes passaram"
