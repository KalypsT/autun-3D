#!/bin/sh
# Construit, sert dist/ le temps des captures, puis arrête le serveur.
# Usage : tools/shot.sh <dossier-de-sortie> vue[:paramètres] ...
set -e
out="$1"; shift
port=$((4200 + $$ % 700))
npx vite build > /dev/null
npx vite preview --port "$port" --strictPort > /dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 1; done
node tools/capture.cjs "http://localhost:$port/" "$out" "$@"
