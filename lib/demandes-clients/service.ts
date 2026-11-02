import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";

// REV (01/11/2026) — VUE ADMIN DES DEMANDES CLIENTS.
//
// Une seule liste, réservée à l'Admin, de tout ce que les Clients ont
// demandé à l'équipe ATLAS et qui attend une réponse :
//   - Talents : « je souhaite poursuivre », « ne pas retenir », « autres
//     profils » (ActionTalentClient) ;
//   - Projets : intérêt pour une proposition, demande de précision
//     (EvenementProjet.statutTraitement) ; proposition acceptée en attente de
//     confirmation d'engagement (statut du projet ACCEPTEE) ;
//   - ATLAS OS : demande d'activation (ActivationAtlasOs DEMANDEE).
// Chaque demande se traite ici (prise en charge, clôture) ou, quand l'action
// est métier (confirmer un engagement, activer ATLAS OS), sur sa page dédiée
// — jamais deux circuits concurrents. Toute transition est conditionnée au
// statut lu (pas d'écrasement silencieux) et journalisée.

export type SourceDemande = "TALENT" | "PROJET" | "ENGAGEMENT" | "ATLAS_OS";
export type StatutDemande = "ENVOYEE" | "PRISE_EN_CHARGE" | "CLOTUREE";

export type DemandeClient = {
  cle: string; // `${source}:${id}`
  source: SourceDemande;
  id: string;
  type: string;
  libelle: string;
  client: { id: string; nom: string };
  objet: { titre: string; href: string };
  detail: string | null;
  statut: StatutDemande;
  // Traitement possible directement depuis la liste (sinon : page dédiée).
  traitableIci: boolean;
  creeLe: string;
  traiteLe: string | null;
  traiteParEmail: string | null;
};

const LIBELLES_TALENT: Record<string, string> = {
  POURSUIVRE: "Souhaite poursuivre avec un profil proposé",
  NE_PAS_RETENIR: "Ne retient pas un profil proposé",
  AUTRES_PROFILS: "Demande d'autres profils",
};
const LIBELLES_PROJET: Record<string, string> = {
  INTERET_MANIFESTE: "Intérêt pour une proposition",
  DEMANDE_PRECISION: "Demande de précision sur une proposition",
};

export const TYPES_EVENEMENT_A_TRAITER = Object.keys(LIBELLES_PROJET);

const TRANSITIONS: Record<StatutDemande, StatutDemande[]> = {
  ENVOYEE: ["PRISE_EN_CHARGE", "CLOTUREE"],
  PRISE_EN_CHARGE: ["CLOTUREE"],
  CLOTUREE: [],
};

const OUVERTS: StatutDemande[] = ["ENVOYEE", "PRISE_EN_CHARGE"];

// Nombre de demandes jamais prises en charge (pastille du menu Admin).
export async function compterDemandesEnAttente(): Promise<number> {
  const [talents, evenements, engagements, activations] = await Promise.all([
    prisma.actionTalentClient.count({ where: { statut: "ENVOYEE" } }),
    prisma.evenementProjet.count({ where: { statutTraitement: "ENVOYEE" } }),
    prisma.projet.count({ where: { statut: "ACCEPTEE" } }),
    prisma.activationAtlasOs.count({ where: { statut: "DEMANDEE" } }),
  ]);
  return talents + evenements + engagements + activations;
}

export async function listerDemandesClients(filtre: { statut: "OUVERTES" | "CLOTUREES" }): Promise<DemandeClient[]> {
  const statuts = filtre.statut === "OUVERTES" ? OUVERTS : (["CLOTUREE"] as StatutDemande[]);
  const limite = filtre.statut === "OUVERTES" ? 500 : 100;
  const [talents, evenements, engagements, activations] = await Promise.all([
    prisma.actionTalentClient.findMany({
      where: { statut: { in: statuts } },
      orderBy: { createdAt: "desc" },
      take: limite,
      include: { client: { select: { id: true, nom: true } }, need: { select: { id: true, titre: true, texteOriginal: true } } },
    }),
    prisma.evenementProjet.findMany({
      where: { statutTraitement: { in: statuts } },
      orderBy: { createdAt: "desc" },
      take: limite,
      include: { projet: { select: { id: true, titre: true, client: { select: { id: true, nom: true } } } } },
    }),
    filtre.statut === "OUVERTES"
      ? prisma.projet.findMany({ where: { statut: "ACCEPTEE" }, orderBy: { updatedAt: "desc" }, include: { client: { select: { id: true, nom: true } } } })
      : Promise.resolve([]),
    filtre.statut === "OUVERTES"
      ? prisma.activationAtlasOs.findMany({ where: { statut: "DEMANDEE" }, orderBy: { demandeLe: "desc" }, include: { client: { select: { id: true, nom: true } } } })
      : Promise.resolve([]),
  ]);

  const demandes: DemandeClient[] = [
    ...talents.map((a) => ({
      cle: `TALENT:${a.id}`,
      source: "TALENT" as const,
      id: a.id,
      type: a.type,
      libelle: LIBELLES_TALENT[a.type] ?? a.type,
      client: a.client,
      objet: { titre: a.need.titre ?? a.need.texteOriginal.slice(0, 80), href: `/admin/talent/besoins/${a.need.id}` },
      detail: a.commentaire,
      statut: a.statut as StatutDemande,
      traitableIci: true,
      creeLe: a.createdAt.toISOString(),
      traiteLe: a.traiteLe?.toISOString() ?? null,
      traiteParEmail: a.traiteParEmail,
    })),
    ...evenements.map((e) => ({
      cle: `PROJET:${e.id}`,
      source: "PROJET" as const,
      id: e.id,
      type: e.type,
      libelle: LIBELLES_PROJET[e.type] ?? e.type,
      client: e.projet.client,
      objet: { titre: e.projet.titre, href: `/admin/projets/${e.projet.id}` },
      detail: e.detail,
      statut: e.statutTraitement as StatutDemande,
      traitableIci: true,
      creeLe: e.createdAt.toISOString(),
      traiteLe: e.traiteLe?.toISOString() ?? null,
      traiteParEmail: e.traiteParEmail,
    })),
    ...engagements.map((p) => ({
      cle: `ENGAGEMENT:${p.id}`,
      source: "ENGAGEMENT" as const,
      id: p.id,
      type: "PROPOSITION_ACCEPTEE",
      libelle: "Proposition acceptée : engagement à confirmer",
      client: p.client,
      objet: { titre: p.titre, href: `/admin/projets/${p.id}` },
      detail: null,
      statut: "ENVOYEE" as const,
      traitableIci: false,
      creeLe: p.updatedAt.toISOString(),
      traiteLe: null,
      traiteParEmail: null,
    })),
    ...activations.map((a) => ({
      cle: `ATLAS_OS:${a.id}`,
      source: "ATLAS_OS" as const,
      id: a.id,
      type: "ACTIVATION",
      libelle: "Demande d'activation d'ATLAS OS",
      client: a.client,
      objet: { titre: "ATLAS OS", href: "/admin/atlas-os" },
      detail: a.motifDemande,
      statut: "ENVOYEE" as const,
      traitableIci: false,
      creeLe: a.demandeLe.toISOString(),
      traiteLe: null,
      traiteParEmail: null,
    })),
  ];
  // Les plus anciennes d'abord parmi les demandes ouvertes (premier arrivé,
  // premier servi) ; les plus récentes d'abord dans l'historique.
  return demandes.sort((a, b) => (filtre.statut === "OUVERTES" ? a.creeLe.localeCompare(b.creeLe) : b.creeLe.localeCompare(a.creeLe)));
}

export type ResultatTraitement = { ok: true } | { ok: false; code: 400 | 404 | 409; erreur: string };

export async function traiterDemandeClient(params: { source: string; id: string; statut: string; adminEmail: string }): Promise<ResultatTraitement> {
  const statut = params.statut as StatutDemande;
  if (statut !== "PRISE_EN_CHARGE" && statut !== "CLOTUREE") return { ok: false, code: 400, erreur: "statut : PRISE_EN_CHARGE ou CLOTUREE." };

  if (params.source === "TALENT") {
    const action = await prisma.actionTalentClient.findUnique({ where: { id: params.id } });
    if (!action) return { ok: false, code: 404, erreur: "Demande introuvable." };
    if (!TRANSITIONS[action.statut as StatutDemande].includes(statut)) return { ok: false, code: 409, erreur: `Transition ${action.statut} -> ${statut} non autorisée.` };
    const maj = await prisma.actionTalentClient.updateMany({
      where: { id: action.id, statut: action.statut },
      data: { statut, traiteParEmail: params.adminEmail, traiteLe: new Date() },
    });
    if (maj.count === 0) return { ok: false, code: 409, erreur: "La demande a changé entre-temps, rechargez la page." };
  } else if (params.source === "PROJET") {
    const evenement = await prisma.evenementProjet.findUnique({ where: { id: params.id } });
    if (!evenement || !evenement.statutTraitement) return { ok: false, code: 404, erreur: "Demande introuvable." };
    if (!TRANSITIONS[evenement.statutTraitement].includes(statut)) return { ok: false, code: 409, erreur: `Transition ${evenement.statutTraitement} -> ${statut} non autorisée.` };
    const maj = await prisma.evenementProjet.updateMany({
      where: { id: evenement.id, statutTraitement: evenement.statutTraitement },
      data: { statutTraitement: statut, traiteParEmail: params.adminEmail, traiteLe: new Date() },
    });
    if (maj.count === 0) return { ok: false, code: 409, erreur: "La demande a changé entre-temps, rechargez la page." };
  } else {
    return { ok: false, code: 400, erreur: "Cette demande se traite depuis sa page dédiée." };
  }
  await journaliser({
    acteurEmail: params.adminEmail,
    acteurRole: "ADMIN",
    action: `demande_client_${statut.toLowerCase()}`,
    cible: `${params.source}:${params.id}`,
  });
  return { ok: true };
}
