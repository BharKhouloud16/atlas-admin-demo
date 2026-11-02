// V1 — réimport d'un CV sans écraser les informations déjà validées.
//
// Avant : chaque import supprimait TOUTES les InfoCV du profil (y compris
// celles que l'ingénieur avait corrigées et validées) puis les remplaçait par
// l'extraction brute — une perte silencieuse de données validées.
// Désormais : les informations validées restent la source de vérité ; seules
// les informations encore NON validées sont remplacées par la nouvelle
// extraction, et un champ déjà validé n'est jamais recréé en doublon.
// Fonction pure (testée dans tests/unit/cv-fusion.spec.ts).

export type InfoCvExistante = { categorie: string; libelle: string; valide: boolean };
export type ChampExtrait = { categorie: string; libelle: string; valeur: string; ordre: number };

export const TAILLE_MAX_CV_OCTETS = 10 * 1024 * 1024; // 10 Mo

function cle(categorie: string, libelle: string): string {
  return `${categorie.trim().toLowerCase()}::${libelle.trim().toLowerCase()}`;
}

export function fusionnerInfosCv(existantes: InfoCvExistante[], extraits: ChampExtrait[]) {
  const validees = new Set(existantes.filter((i) => i.valide).map((i) => cle(i.categorie, i.libelle)));
  const dejaVus = new Set<string>();
  const aCreer: ChampExtrait[] = [];
  for (const champ of extraits) {
    const k = cle(champ.categorie, champ.libelle);
    if (validees.has(k) || dejaVus.has(k)) continue;
    dejaVus.add(k);
    aCreer.push(champ);
  }
  return { aCreer, conservees: validees.size };
}

// Signature d'un fichier PDF : « %PDF- » dans les premiers octets. Le type
// MIME envoyé par le navigateur est déclaratif (et peut être vide) : il ne
// suffit pas à garantir le format.
export function estPdf(octets: Uint8Array): boolean {
  const entete = Array.from(octets.slice(0, 1024));
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let i = 0; i + signature.length <= entete.length; i++) {
    if (signature.every((b, j) => entete[i + j] === b)) return true;
  }
  return false;
}
