import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { LIBELLE_ANNEES_EXPERIENCE, LIBELLE_SENIORITE } from "@/lib/cv-extraction";
import { construireSkillGraph } from "@/lib/talent/skill-graph-service";

// Appelé une fois que l'ingénieur a validé (OK) tous les champs extraits de
// son CV. Marque le profil comme cvValide=true, ce qui débloque l'accès à
// l'espace ingénieur (voir app/admin/layout.tsx).
//
// ATLAS ENGINEER INTELLIGENCE PROFILE — Phase 1 (28/09/2026) : réalise
// l'ancien TODO (analyse-profil) ci-dessous, mais UNIQUEMENT pour les deux
// champs qui ont une source réelle et déjà extraite par l'IA
// (lib/cv-extraction.ts, MODELE_CHAMPS_CV) :
//   - Profil.anneesExperience  <- InfoCV "Années d'expérience"
//   - Profil.seniorite         <- InfoCV "Séniorité (...)"
// Ce ne sont PAS des données calculées (aucun champ "année de début de
// carrière" n'existe dans le schéma pour les dériver dynamiquement) : ce
// sont des valeurs extraites (ou corrigées par l'ingénieur) copiées telles
// quelles, à CHAQUE finalisation — y compris un ré-import ultérieur, où
// elles sont explicitement remises à `null` si la nouvelle extraction n'a
// plus rien d'exploitable (jamais une ancienne valeur laissée à traîner).
//
// `pointsForts`, `tjmEstime` et `typeContratSuggere` restent délibérément
// NON alimentés ici : aucune de ces trois colonnes n'a de source réelle
// aujourd'hui (rien dans MODELE_CHAMPS_CV ne les extrait, et aucune logique
// de calcul ATLAS n'existe encore) — les fabriquer à partir d'une valeur
// extraite pour une autre finalité présenterait une intelligence ATLAS
// inexistante comme si elle existait. Elles restent `null` jusqu'à ce
// qu'une source réelle existe (Phase 2, décision produit requise — voir
// diagnostic validé).
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const restants = await prisma.infoCV.count({
    where: { profilId: session.profilId, valide: false },
  });
  if (restants > 0) {
    return NextResponse.json(
      { error: `${restants} information(s) restent à valider avant de finaliser.` },
      { status: 400 }
    );
  }

  const [infoAnnees, infoSeniorite] = await Promise.all([
    prisma.infoCV.findFirst({ where: { profilId: session.profilId, libelle: LIBELLE_ANNEES_EXPERIENCE } }),
    prisma.infoCV.findFirst({ where: { profilId: session.profilId, libelle: LIBELLE_SENIORITE } }),
  ]);

  // "Années d'expérience" est un texte libre (ex. "7", "7 ans", vide) — on
  // n'en retient un entier que s'il en contient un exploitable ; jamais une
  // valeur inventée ou arrondie arbitrairement en cas de doute.
  //
  // CORRECTIF STALENESS (28/09/2026) — ces deux champs sont désormais
  // TOUJOURS écrits explicitement (valeur ou `null`), jamais omis : un
  // ré-import de CV est possible à tout moment (voir app/api/ingenieur/cv/
  // route.ts, qui repasse cvValide=false et recrée les InfoCV) et doit
  // refléter fidèlement le CV actuellement en vigueur. Omettre la clé
  // quand la nouvelle extraction n'a rien d'exploitable laissait
  // auparavant une ancienne valeur, potentiellement fausse, survivre en
  // base après une correction — contraire au principe qu'ATLAS actualise
  // ces données plutôt que de les figer à leur première valeur.
  const anneesExtraites = infoAnnees?.valeur.match(/\d+/)?.[0];
  const anneesExperience = anneesExtraites !== undefined ? parseInt(anneesExtraites, 10) : null;
  const seniorite = infoSeniorite?.valeur.trim() || null;

  await prisma.profil.update({
    where: { id: session.profilId },
    data: {
      cvValide: true,
      anneesExperience,
      seniorite,
    },
  });

  // LOT 11 — ATLAS SKILL INTELLIGENCE V1 : construit/actualise automatiquement
  // le Skill Graph dès la finalisation du CV, en réutilisant la même fonction
  // métier que la route Admin (lib/talent/skill-graph-service.ts) — jamais un
  // appel HTTP interne. Best-effort STRICT (mandat, §3/§4) : la finalisation
  // du CV reste acquise (déjà écrite ci-dessus) quoi qu'il arrive ici ; une
  // panne de cette étape ne doit jamais transformer une absence de preuve en
  // preuve fabriquée, ni empêcher l'ingénieur d'accéder à son espace. Aucune
  // donnée personnelle ni contenu de CV dans le log — seulement l'identifiant
  // de profil (déjà utilisé partout ailleurs dans les journaux ATLAS),
  // l'étape et le type/message technique de l'erreur.
  let skillGraph: "construit" | "echec" = "construit";
  try {
    await construireSkillGraph(session.profilId);
  } catch (e: any) {
    skillGraph = "echec";
    console.error("[cv/finaliser] Construction du Skill Graph impossible — CV finalisé quand même.", {
      profilId: session.profilId,
      etape: "construction_skill_graph",
      typeErreur: e?.constructor?.name ?? "Error",
      message: e?.message ?? String(e),
    });
  }

  return NextResponse.json({ ok: true, skillGraph });
}
