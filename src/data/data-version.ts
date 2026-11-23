/**
 * Version des données lourdes (D305) : tuiles, relief, sols, carte, navigation, décalques sont publiés sous `public/immuable/<version>/`
 * (servis sous `<base>immuable/<version>/`). La version est l'empreinte du contenu, refaite par `python3 tools/data/data_version.py`
 * après chaque régénération ; la chaîne de données lit le même fichier. Un nom qui change avec le contenu permet à l'hôte des jeux de
 * DomoThib de garder ces fichiers en cache un an sans les revalider (contrat, §6).
 */
import stamp from "./data-version.json";

export const DATA_VERSION: string = stamp.version;

/** Dossier des données lourdes, relatif à la racine du site (et à `public/`). */
export const IMMUTABLE_DIR = `immuable/${DATA_VERSION}/`;

/** Adresse d'un fichier publié sous ce dossier, pour une base de site donnée (`import.meta.env.BASE_URL` : `./` ou `/autun-3d/`). */
export const immutableUrl = (base: string, path: string): string => `${base}${IMMUTABLE_DIR}${path}`;

/** Chemins sur le disque, depuis la racine du dépôt (tests, outils). */
export const PUBLIC_DATA = `public/${IMMUTABLE_DIR}data`;
export const PUBLIC_DECALS = `public/${IMMUTABLE_DIR}decals`;
