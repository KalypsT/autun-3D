#!/bin/sh
# Captures de l'écran de chargement (D338) : construit le jeu, le sert, rejoue les mises en scène, puis convertit (make_art.py).
# Usage : tools/logo/loading.sh   (rendu logiciel : environ 20 s par image)
# Chaque ligne : nom;paramètres d'URL;cap;inclinaison;attente (ms);touches — voir tools/stage.cjs. L'ordre des noms est celui du diaporama.
set -e
out=.cache/loading
port=$((4200 + $$ % 700))
npx vite build > /dev/null
node_modules/.bin/vite preview --port "$port" --strictPort > /dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 1; done
node tools/stage.cjs "http://localhost:$port/" "$out" \
  "01-cathedrale;at=58,-512&h=18.7&weather=beau&yaw=0.0;3.45;-0.25;3500" \
  "02-visee;at=-10,-20&h=20.6&weather=beau&arms=pistol&yaw=0.3;0.3;0;4000;4,v" \
  "03-toits;at=20,-512&h=18.9&weather=beau&yaw=0.3;2.9;-0.1;3500" \
  "04-gare;at=-451.6,518&h=8.2&weather=beau&yaw=-2.22;-2.22;-0.05;4000" \
  "05-nuit;at=15,35&h=22.6&weather=beau&ride=moto&yaw=0;;;5000" \
  "06-janus;at=-780,1180&h=17.5&weather=beau&yaw=-0.6;-0.6;-0.1;4000" \
  "07-croix;at=-841,-1782&h=9&weather=beau&yaw=3.14;3.14;-0.15;4000" \
  "08-couhard;at=1160,-735&h=18.3&weather=beau&yaw=2.33;2.33;-0.15;4000"
python3 tools/logo/make_art.py
