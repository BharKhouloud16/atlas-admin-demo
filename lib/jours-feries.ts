// Jours fériés utilisés par le calendrier de l'Emploi du temps (voir
// EspaceIngenieur.tsx, composant CalendrierCra) : les jours grisés dépendent
// du PAYS DU CLIENT de la mission (Client.pays), pas du pays de résidence de
// l'ingénieur — décision explicite de l'utilisatrice, une mission facturée à
// un client français suit le calendrier français même si l'ingénieur est basé
// ailleurs. Un jour grisé (week-end ou férié) reste débloquable au cas par
// cas par l'ingénieur via un commentaire justificatif (voir toggleJour dans
// CalendrierCra) : cette liste n'a donc pas besoin d'être parfaite pour
// rester utilisable.
//
// Limite connue et assumée : seuls les jours fériés à date FIXE (et les
// fêtes chrétiennes mobiles calculées via l'algorithme de Gauss pour le pays
// concerné) sont couverts. Les fêtes à calendrier lunaire/hégirien (Aïd
// el-Fitr, Aïd el-Adha, Ramadan...) et les jours fériés locaux/régionaux ne
// sont PAS calculés ici : dans ce cas, l'ingénieur débloque le jour avec un
// commentaire ("Aïd el-Fitr" par ex.) — plus fiable qu'une date approximative.

export function dimanchePaques(annee: number): { mois: number; jour: number } {
  // Algorithme de Gauss (calendrier grégorien) — donne le dimanche de Pâques,
  // à partir duquel se déduisent Lundi de Pâques (+1), Ascension (+39) et
  // Lundi de Pentecôte (+50), utilisés par les pays européens ci-dessous.
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return { mois, jour };
}

function ajouterJours(annee: number, mois: number, jour: number, delta: number): string {
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  d.setUTCDate(d.getUTCDate() + delta);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fetesMobilesChretiennes(annee: number): string[] {
  const p = dimanchePaques(annee);
  return [
    ajouterJours(annee, p.mois, p.jour, 1), // Lundi de Pâques
    ajouterJours(annee, p.mois, p.jour, 39), // Ascension
    ajouterJours(annee, p.mois, p.jour, 50), // Lundi de Pentecôte
  ];
}

// Jours fixes "MM-JJ" par pays (liste des pays proposés à l'inscription
// client, voir lib/localisation.ts PAYS). Les pays hors de cette liste (ou
// "Autre") retombent sur FIXES_DEFAUT (Nouvel An + Noël, socle quasi
// universel) plutôt que de bloquer arbitrairement des jours incertains.
const FIXES_PAR_PAYS: Record<string, string[]> = {
  France: ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"],
  Belgique: ["01-01", "05-01", "07-21", "08-15", "11-01", "11-11", "12-25"],
  Suisse: ["01-01", "08-01", "12-25"],
  Allemagne: ["01-01", "05-01", "10-03", "12-25", "12-26"],
  Espagne: ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"],
  Italie: ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"],
  Portugal: ["01-01", "04-25", "05-01", "06-10", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25"],
  "Royaume-Uni": ["01-01", "12-25", "12-26"],
  Luxembourg: ["01-01", "05-01", "06-23", "08-15", "11-01", "12-25", "12-26"],
  Tunisie: ["01-01", "01-14", "03-20", "04-09", "05-01", "07-25", "08-13", "10-15"],
  Maroc: ["01-01", "01-11", "05-01", "07-30", "08-14", "08-20", "08-21", "11-06", "11-18"],
  Algérie: ["01-01", "05-01", "07-05", "11-01"],
  "Émirats arabes unis": ["01-01", "12-01", "12-02"],
  "Arabie Saoudite": ["09-23"],
  Qatar: ["12-18"],
  Koweït: ["02-25", "02-26"],
  Bahreïn: ["12-16"],
  Oman: ["11-18"],
  Canada: ["01-01", "07-01", "12-25", "12-26"],
  "États-Unis": ["01-01", "07-04", "11-11", "12-25"],
};

// Pays où les fêtes chrétiennes mobiles (calculées via Pâques) s'ajoutent
// aux jours fixes ci-dessus — essentiellement l'Europe continentale.
const PAYS_AVEC_FETES_MOBILES = new Set([
  "France",
  "Belgique",
  "Allemagne",
  "Italie",
  "Suisse",
  "Luxembourg",
]);

const FIXES_DEFAUT = ["01-01", "12-25"];

// Retourne les jours fériés de l'année donnée pour un pays, au format
// "AAAA-MM-JJ", triés. `pays` peut être null (mission sans pays renseigné) :
// dans ce cas seul le socle minimal (01-01, 25-12) est grisé.
export function joursFeries(pays: string | null | undefined, annee: number): string[] {
  const fixes = (pays && FIXES_PAR_PAYS[pays]) || FIXES_DEFAUT;
  const mobiles = pays && PAYS_AVEC_FETES_MOBILES.has(pays) ? fetesMobilesChretiennes(annee) : [];
  const toutes = [...fixes, ...mobiles].map((md) => `${annee}-${md}`);
  return Array.from(new Set(toutes)).sort();
}

export function estWeekEnd(dateIso: string): boolean {
  const jour = new Date(dateIso + "T00:00:00").getDay();
  return jour === 0 || jour === 6; // dimanche, samedi
}
