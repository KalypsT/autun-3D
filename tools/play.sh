#!/bin/sh
# Construit, sert dist/ et rejoue un scénario tactile. Usage : tools/play.sh <dossier-de-sortie> [scénario]
set -e
out="$1"; scenario="${2:-walk}"; query="${3:-}"
port=$((4200 + $$ % 700))
npx vite build > /dev/null
npx vite preview --port "$port" --strictPort > /dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 1; done
node tools/play.cjs "http://localhost:$port/" "$out" "$scenario" "$query"
