import type { CollectionDef, CollectionEntry, Fiche } from "./collections";

/**
 * Chasse aux monuments (plaisir de jeu, phase 3, lot 4, D320) : vingt monuments d'Autun, chacun avec une zone de découverte et une fiche
 * historique. Les textes ne sont pas dans le code : ils viennent de `docs/fiches-monuments.md` (relu par l'utilisateur), découpé par
 * `parseFiches` ; corriger une fiche, c'est corriger ce fichier.
 */

/** Grand monument : 600 € ; petit : 300 €. */
export const MONUMENT_REWARD = { grand: 600, petit: 300 } as const;
/** Tous les monuments trouvés : bonus (€). */
export const MONUMENTS_BONUS = 5000;

/**
 * Zone de découverte de chaque monument : un cercle (repère du jeu, m) qui prend le monument et la rue, la place ou le chemin d'où on le
 * voit (vues `?view=` du jeu, D95 et suivantes). On découvre en y entrant, à pied ou en véhicule. Test : chaque zone touche le réseau
 * des piétons ou des voitures.
 */
export interface MonumentSite {
  id: string;
  size: "grand" | "petit";
  x: number;
  y: number;
  radius: number;
}

export const MONUMENT_SITES: readonly MonumentSite[] = [
  { id: "cathedrale", size: "grand", x: 30, y: -572, radius: 40 },
  { id: "arroux", size: "grand", x: -269, y: 1068, radius: 32 },
  { id: "saint-andre", size: "grand", x: 543, y: 840, radius: 32 },
  { id: "theatre-romain", size: "grand", x: 815, y: 285, radius: 75 },
  { id: "janus", size: "grand", x: -798, y: 1206, radius: 35 },
  { id: "couhard", size: "grand", x: 1178, y: -752, radius: 30 },
  { id: "hotel-de-ville", size: "grand", x: 20, y: 78, radius: 30 },
  { id: "theatre-municipal", size: "grand", x: -2, y: 36, radius: 22 },
  { id: "lycee-militaire", size: "grand", x: 585, y: 40, radius: 45 },
  { id: "ursulines", size: "grand", x: 2, y: -958, radius: 35 },
  { id: "croix", size: "grand", x: -841, y: -1809, radius: 35 },
  { id: "gare", size: "grand", x: -440, y: 500, radius: 35 },
  { id: "monument-aux-morts", size: "petit", x: 31, y: -50, radius: 16 },
  { id: "fontaine", size: "petit", x: 42.5, y: -531.6, radius: 14 },
  { id: "lycee-bonaparte", size: "petit", x: -85, y: -112, radius: 30 },
  { id: "tour-horloge", size: "petit", x: 108, y: 390, radius: 22 },
  { id: "apollon", size: "petit", x: 406, y: 12, radius: 18 },
  { id: "prison", size: "petit", x: 80, y: -485, radius: 22 },
  { id: "rolin", size: "petit", x: 50, y: -490, radius: 18 },
  { id: "telots", size: "petit", x: 330, y: 3760, radius: 110 },
];

/** Une fiche découpée dans le document, avec le nom du monument. */
export interface ParsedFiche extends Fiche {
  name: string;
}

/** Texte d'un paragraphe Markdown, lignes rejointes, sans l'italique ni le gras. */
const plain = (s: string): string => s.replace(/\s*\n\s*/g, " ").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\*([^*]*)\*/g, "$1").trim();

/**
 * Découpe `docs/fiches-monuments.md` : chaque `### Nom [id]`, son texte (jusqu'au « Le savais-tu ? »), la phrase « Le savais-tu ? » (vide
 * si elle est « à compléter ») et les sources (sans ce qui suit « À vérifier » ou « À compléter », qui s'adresse au relecteur).
 */
export function parseFiches(md: string): Map<string, ParsedFiche> {
  const out = new Map<string, ParsedFiche>();
  const blocks = md.split(/^### /m).slice(1);
  for (const b of blocks) {
    const head = /^(.+?)\s*\[([a-z0-9-]+)\]\s*\n/.exec(b);
    if (!head) continue;
    const body = b.slice(head[0].length).split(/^---\s*$|^## /m)[0]!;
    const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const text: string[] = [];
    let didYouKnow = "", sources = "";
    for (const p of paras) {
      if (p.startsWith("**Le savais-tu ?**")) {
        const s = plain(p.slice("**Le savais-tu ?**".length));
        didYouKnow = /^\(?à compléter/i.test(s) ? "" : s;
      } else if (p.startsWith("**Sources**")) sources = plain(p.replace(/^\*\*Sources\*\*\s*:\s*/, "").split(/\*\*À (?:vérifier|compléter)\*\*/)[0]!).replace(/[\s.;]+$/, "");
      else if (!didYouKnow && !sources) text.push(plain(p));
    }
    out.set(head[2]!, { name: head[1]!.trim(), text: text.join(" "), didYouKnow, sources });
  }
  return out;
}

/** La collection des monuments, à partir des fiches (le nom vient de la fiche ; un site sans fiche garde son identifiant). */
export function monumentCollection(fiches: ReadonlyMap<string, ParsedFiche>): CollectionDef {
  const entries: CollectionEntry[] = MONUMENT_SITES.map((s) => {
    const f = fiches.get(s.id);
    return {
      id: s.id, name: f?.name ?? s.id, x: s.x, y: s.y, radius: s.radius, reward: MONUMENT_REWARD[s.size],
      group: s.size === "grand" ? "Grands monuments" : "Petits monuments",
      ...(f ? { fiche: { text: f.text, didYouKnow: f.didYouKnow, sources: f.sources } } : {}),
    };
  });
  return { id: "monuments", label: "Monuments", entries, bonus: MONUMENTS_BONUS };
}
