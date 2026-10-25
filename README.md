# Autun 3D

Jeu 3D en monde ouvert dans la vraie ville d'Autun (Saône-et-Loire), sur téléphone.

Phase actuelle : maquette réaliste du quartier de la mairie, autour de la place du Champ de Mars.

- Sources de données, couverture et licences : [docs/SOURCES.md](docs/SOURCES.md)
- Décisions : [docs/DECISIONS.md](docs/DECISIONS.md)
- Avancement : [PROGRESS.md](PROGRESS.md)

## Chaîne de données

```sh
python3 -m pip install -r tools/data/requirements.txt
python3 -I tools/data/probe_sources.py   # vérifie l'accès et la couverture de chaque source
```
