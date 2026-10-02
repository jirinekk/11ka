#!/bin/sh
# Produkční start (Pterodactyl) - bez build:css a bez npm install při každém bootu.
# CSS je v repu (public/css/tailwind.generated.css), compression je v package.json.
set -e
cd "$(dirname "$0")"
exec node server.js
