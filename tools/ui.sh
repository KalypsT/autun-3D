#!/bin/sh
# Construit, sert dist/ et rejoue les écrans de l'interface (J1) en tactile. Usage : tools/ui.sh <dossier-de-sortie> [scénario]
set -e
out="$1"; scenario="${2:-all}"
port=$((4200 + $$ % 700))
npx vite build > /dev/null
# Le serveur lancé directement (sans npx) : son pid est celui de node, que le trap arrête vraiment (avec npx, il restait ouvert,
# et une capture suivante tombant sur le même port photographiait une ancienne construction).
node_modules/.bin/vite preview --port "$port" --strictPort > /dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 1; done
node tools/ui-shots.cjs "http://localhost:$port/" "$out" "$scenario"
