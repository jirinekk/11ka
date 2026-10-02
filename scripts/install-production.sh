#!/bin/sh
# Jednorázová instalace na serveru (spusťte v konzoli panelu, ne při každém startu).
set -e
cd "$(dirname "$0")/.."
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/tmp/npm-cache}"
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false
npm ci --omit=dev
npm cache clean --force 2>/dev/null || true
echo "Hotovo. Startup příkaz nastavte na: bash start.sh"
