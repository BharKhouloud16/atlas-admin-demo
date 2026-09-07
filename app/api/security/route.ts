import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ACTIFS_CONNUS, CONTROLES_CONNUS, POINTS_ENTREE_CONNUS, construireObservationDepuisControle } from "@/lib/security/assets";
import { deriverSignauxSecurite } from "@/lib/security/signals";
import { construireSecurityAnalysis } from "@/lib/security/analysis";
import { construireFindingsDepuisSignaux } from "@/lib/security/findings";
import { construireRootCausesDepuisFindings } from "@/lib/security/rootcause";
import { construireImpactsDepuisFindings, construireRisquesDepuisImpacts } from "@/lib/security/risk";

// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.9, 07/09/2026).
// Première route API du Security Signal Engine : lecture seule, aucune
// écriture, aucune persistance. Assemble la chaîne complète déjà construite
// (B13.1-B13.8) : OBSERVATION -> SIGNAL -> ANALYSIS -> FINDING -> ROOT
// CAUSE -> IMPACT -> RISK. Réservé Admin (directive B13, section 14 :
// "Security Intelligence API = ADMIN ONLY" par défaut ; aucune donnée
// interne de sécurité exposée au Client ou à l'Ingénieur).
//
// SOURCE DES OBSERVATIONS — HONNÊTETÉ VOLONTAIRE (directive B13, section
// 15) : contrairement à /api/quality (Batch 12.7, branché sur une lecture
// EXTERNE en direct — l'API GitHub Actions), cette route ne dispose
// d'AUCUN connecteur d'audit dynamique en B13 V1 (le connecteur client
// authentifié/isolé/révocable reste hors périmètre, directive section 15).
// Les observations exposées ici proviennent donc du registre STATIQUE des
// contrôles déjà vérifiés par lecture directe du code lors de B13.0-B13.4
// (lib/security/assets.ts, CONTROLES_CONNUS) : chaque contrôle produit une
// observation PASS avec source CODE_REVIEW, citant le fichier réel où le
// mécanisme a été constaté — jamais une vérification dynamique, jamais
// prétendu être un audit de sécurité complet. `avertissement` dans la
// réponse rend cette limite explicite pour tout consommateur de l'API.
//
// RÈGLES ABSOLUES (héritées de B13.1-B13.8, reconduites ici) :
// - ZÉRO score global, zéro verdict de synthèse, zéro sévérité inventée :
//   la réponse reste la structure déjà construite par lib/security/*
//   (Findings/RootCauses/Impacts/Risques restent UNKNOWN par défaut, comme
//   documenté dans chaque module — cette route ne recalcule rien).
// - ZÉRO persistance : aucune table Prisma, aucune écriture.
// - Une seule construction en mémoire par requête (pas de N+1) : le
//   registre statique est déjà en mémoire (import), la dérivation
//   observation -> signal -> analyse -> finding -> rootcause -> impact ->
//   risque est un calcul pur, aucun appel réseau ni base de données.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B12.
//
// SÉCURITÉ (même discipline que Batch 12.8) :
// - Seul GET est exporté : toute autre méthode reçoit automatiquement un
//   405 Method Not Allowed (comportement natif Next.js App Router, aucun
//   handler additionnel).
// - Aucun paramètre de requête, aucun corps : rien à valider côté entrée
//   utilisateur.
// - Isolation locataire (tenant) : non applicable — cette route n'expose
//   AUCUNE donnée Client/Ingénieur/Profil, uniquement l'état des contrôles
//   du dépôt ATLAS lui-même (même principe que /api/quality). Aucun
//   paramètre d'identifiant en entrée -> aucune énumération d'ID possible.
// - Aucun secret : construireObservationDepuisControle/construireObservationSecurite
//   (B13.2) rejettent toute entrée dont un champ ressemble à un secret —
//   déjà appliqué en amont, cette route ne réintroduit aucune donnée brute.
// - Gestion des erreurs : toute exception inattendue est interceptée et
//   retourne un 500 générique, jamais la stack trace ni le détail interne.

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const horodatage = new Date();
    const observations = CONTROLES_CONNUS.map((controle) =>
      construireObservationDepuisControle(controle.id, "PASS", horodatage, {
        source: "CODE_REVIEW",
        preuveComplementaire: "Vérifié par revue de code directe (B13.0-B13.4) — aucune vérification dynamique en B13 V1.",
      })
    ).filter((observation): observation is NonNullable<typeof observation> => observation !== null);

    const signaux = deriverSignauxSecurite(observations);
    const analyse = construireSecurityAnalysis(observations, signaux);
    const findings = construireFindingsDepuisSignaux(signaux);
    const rootCauses = construireRootCausesDepuisFindings(findings);
    const impacts = construireImpactsDepuisFindings(findings, rootCauses);
    const risques = construireRisquesDepuisImpacts(findings, impacts);

    return NextResponse.json({
      avertissement:
        "État de sécurité basé sur une revue de code statique (B13.0-B13.4) : aucun connecteur client ni audit dynamique en B13 V1 (voir directive B13, section 15). Absence de Finding/Risque ne signifie pas absence de vulnérabilité — uniquement l'absence d'échec observé sur les contrôles déjà recensés.",
      actifsConnus: ACTIFS_CONNUS,
      pointsEntreeConnus: POINTS_ENTREE_CONNUS,
      controlesConnus: CONTROLES_CONNUS,
      observations,
      signaux,
      analyse,
      findings,
      rootCauses,
      impacts,
      risques,
    });
  } catch {
    // Jamais de stack trace ni de détail interne exposé au client — voir
    // note SÉCURITÉ ci-dessus.
    return NextResponse.json({ error: "Erreur interne lors du calcul de l'état de sécurité." }, { status: 500 });
  }
}
