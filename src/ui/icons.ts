/**
 * Pictogrammes de l'interface en jeu (D103), dessinés en SVG au lieu des emoji : un emoji change de dessin d'un téléphone à l'autre
 * et ne suit pas le style « affiche ». Trait de la couleur du texte (`currentColor`), grille de 24 × 24.
 */

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  fists: `<path ${STROKE} d="M7 11V8.5a1.5 1.5 0 0 1 3 0V11m0-2.5V7a1.5 1.5 0 0 1 3 0v4m0-3.5a1.5 1.5 0 0 1 3 0V11m0-2a1.5 1.5 0 0 1 3 0v5a6 6 0 0 1-6 6h-1.5A5.5 5.5 0 0 1 5 14.5V13a2 2 0 0 1 2-2h3.5a1.5 1.5 0 0 1 0 3H9"/>`,
  knife: `<path ${STROKE} d="M10.5 13.5L20 4c.8 4.5-1.6 8.6-6.5 12.5z"/><path ${STROKE} d="M10.5 13.5l3 3M11.5 15.5L5.5 21.5l-3-3 6-6"/>`,
  bat: `<path ${STROKE} d="M8.2 17.6L17.4 5.2a2.6 2.6 0 0 1 4 3.3L11.4 19.4z"/><path ${STROKE} d="M8.2 17.6l3.2 1.8L8 22.5 5 20.7z"/>`,
  pistol: `<path fill="currentColor" d="M3 7h16l2 2v3h-9l-1 2.5H8L7 20H3.5l1.2-7H3z"/>`,
  shotgun: `<path fill="currentColor" d="M1.5 9H20l2.5 1v2.2H11L10 14H7.4l-2 4.5H2.2L4 13H1.5z"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M13 14.5h4"/>`,
  rifle: `<path fill="currentColor" d="M1.5 9h13V6.5h2V9h6v2.4h-8.3l-1 4.1h-2.3l.6-4.1H9l-3.2 5.4H2.4l2.4-5.4H1.5z"/>`,
  bike: `<circle ${STROKE} cx="5.5" cy="16" r="3.5"/><circle ${STROKE} cx="18.5" cy="16" r="3.5"/><path ${STROKE} d="M5.5 16L9.5 9h6.5l2.5 7M9.5 9l3.5 7H5.5M14.5 5.5h2.5L16 9M8 6.5h3"/>`,
  kickscooter: `<circle ${STROKE} cx="5.5" cy="18" r="2.5"/><circle ${STROKE} cx="18.5" cy="18" r="2.5"/><path ${STROKE} d="M8 18h8M17.5 15.6L14.5 4H11"/>`,
  car: `<path ${STROKE} d="M4 14.5l1.8-4.6A2 2 0 0 1 7.7 8.5h8.6a2 2 0 0 1 1.9 1.4L20 14.5v2.5H4z"/><circle fill="currentColor" cx="7.5" cy="19" r="2.4"/><circle fill="currentColor" cx="16.5" cy="19" r="2.4"/>`,
  police: `<path ${STROKE} d="M4 14.5l1.8-4.6A2 2 0 0 1 7.7 8.5h8.6a2 2 0 0 1 1.9 1.4L20 14.5v2.5H4z"/><circle fill="currentColor" cx="7.5" cy="19" r="2.4"/><circle fill="currentColor" cx="16.5" cy="19" r="2.4"/><path fill="currentColor" d="M10 4.5h4v2.5h-4z"/>`,
  moto: `<circle ${STROKE} cx="5" cy="16" r="3.2"/><circle ${STROKE} cx="19" cy="16" r="3.2"/><path ${STROKE} d="M5 16h6.5l3-5H9M13.5 7.5h3L19 16M8 11l3.5 5"/>`,
  scooter: `<circle ${STROKE} cx="5.5" cy="17" r="2.6"/><circle ${STROKE} cx="18.5" cy="17" r="2.6"/><path ${STROKE} d="M8 17h5.5l2.5-10h-2.5M16 7h2.5M4.5 13.5H12"/>`,
  gas: `<path ${STROKE} stroke-width="2.6" d="M6 12l6-6 6 6M6 18.5l6-6 6 6"/>`,
  brake: `<rect ${STROKE} stroke-width="2.4" x="3" y="7" width="18" height="10" rx="2.5"/><path ${STROKE} d="M8 10.5v3M12 10.5v3M16 10.5v3"/>`,
  handbrake: `<path ${STROKE} stroke-width="2.6" d="M12 21V9"/><circle fill="currentColor" cx="12" cy="6.5" r="3.5"/>`,
  horn: `<path ${STROKE} d="M3 10v4h3l8 4V6l-8 4z"/><path ${STROKE} d="M17.5 9a4 4 0 0 1 0 6M20 7a7 7 0 0 1 0 10"/>`,
  bell: `<path ${STROKE} d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path ${STROKE} d="M10 20.5a2 2 0 0 0 4 0"/>`,
  exit: `<path ${STROKE} stroke-width="2.2" d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>`,
  reload: `<path ${STROKE} stroke-width="2.4" d="M20 12a8 8 0 1 1-2.3-5.7"/><path ${STROKE} stroke-width="2.4" d="M20 4v4h-4"/>`,
} as const;

export type IconName = keyof typeof PATHS;

/** Le SVG d'un pictogramme, prêt pour `innerHTML` (décoratif : le libellé est porté par l'élément). */
export function icon(name: IconName): string {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Pictogramme d'une arme du catalogue (les identifiants des armes sont des noms de pictogrammes). */
export function weaponIcon(id: string): string {
  return icon(id in PATHS ? (id as IconName) : "fists");
}

/** Pictogramme d'un véhicule : celui du modèle s'il en a un (scooter, gendarmerie), sinon celui de sa famille. */
export function vehicleIcon(modelId: string, family: string): string {
  if (modelId === "scooter-125") return icon("scooter");
  if (modelId === "gendarmerie") return icon("police");
  return icon(family in PATHS ? (family as IconName) : "car");
}
