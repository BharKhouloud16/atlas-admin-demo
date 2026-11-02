import type { ClientNeedFaitCle, Prisma } from "@prisma/client";
import { extraireBesoinClient, CLES_IMPORTANTES_SI_ABSENTES } from "@/lib/client-need/extraction";
import { evaluerCoherenceBesoin } from "@/lib/client-need/coherence";
import { nouveauCorrelationId } from "@/lib/security/events";
import { CLES_REPETABLES } from "@/lib/client-need/faits";

// LOT 6 (28/10/2026) — préparation d'un nouveau ClientNeed à partir d'un
// texte libre, extraite telle quelle de POST /api/client/besoins pour être
// RÉUTILISÉE par les projets complets (jamais un second moteur d'analyse) :
// extraction locale, faits INCONNU explicites pour les attributs importants
// absents, analyse de cohérence. Ne fait aucune écriture : l'appelant crée
// la ligne (éventuellement dans une transaction).
export async function preparerNouveauBesoin(params: {
  clientId: string;
  texteOriginal: string;
  titre: string | null;
  faitsSupplementaires?: { cle: ClientNeedFaitCle; valeur: string; source: string }[];
}): Promise<Prisma.ClientNeedUncheckedCreateInput> {
  const extraction = await extraireBesoinClient(params.texteOriginal);

  // LOT 7 (01/11/2026, assistant Besoins) : une valeur DÉCLARÉE explicitement
  // par le Client (formulaire) l'emporte sur la valeur déduite du texte pour
  // la même clé non répétable — jamais deux valeurs concurrentes écrites au
  // même instant. Les clés répétables (compétences…) s'additionnent.
  const clesDeclarees = new Set((params.faitsSupplementaires ?? []).map((f) => f.cle as string).filter((c) => !CLES_REPETABLES.has(c)));
  extraction.faits = extraction.faits.filter((f) => !clesDeclarees.has(f.cle));

  // Complète les attributs importants non détectés par une ligne
  // INCONNU explicite plutôt que silencieuse (jamais une valeur
  // inventée) — voir lib/client-need/extraction.ts.
  const clesDetectees = new Set<string>([...extraction.faits.map((f) => f.cle as string), ...clesDeclarees]);
  const faitsInconnus = CLES_IMPORTANTES_SI_ABSENTES.filter((cle) => !clesDetectees.has(cle as string)).map((cle) => ({
    cle: cle as ClientNeedFaitCle,
    valeur: "",
    statut: "INCONNU" as const,
  }));

  const coherence = evaluerCoherenceBesoin([
    ...extraction.faits,
    ...(params.faitsSupplementaires ?? []).map((f) => ({ cle: f.cle, valeur: f.valeur, statut: "DECLARE" as const })),
  ]);

  return {
    clientId: params.clientId,
    correlationId: nouveauCorrelationId(),
    texteOriginal: params.texteOriginal,
    titre: params.titre,
    statut: "SOUMIS",
    coherenceStatut: coherence.statut,
    coherenceDetail: coherence.detail,
    analyseProvider: extraction.provider,
    analyseeLe: new Date(),
    faits: {
      create: [
        ...extraction.faits.map((f) => ({ cle: f.cle as ClientNeedFaitCle, valeur: f.valeur, statut: f.statut, source: "extraction" })),
        ...faitsInconnus.map((f) => ({ cle: f.cle, valeur: f.valeur, statut: f.statut, source: null })),
        ...(params.faitsSupplementaires ?? []).map((f) => ({ cle: f.cle, valeur: f.valeur, statut: "DECLARE" as const, source: f.source })),
      ],
    },
  };
}
