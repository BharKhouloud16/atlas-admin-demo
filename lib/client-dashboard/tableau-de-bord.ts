import { prisma } from "@/lib/prisma";
import { synchroniserAttentionsClient } from "@/lib/attention/synchronisation";
import { comparerAttentions } from "@/lib/attention/generateurs";
import { evaluerCompletude, type ClientPourCompletude, CHAMPS_ENTREPRISE } from "@/lib/client-profile/completude";
import { compterPropositionsSansReponse } from "@/lib/client-talent/suivi";
import { etatAtlasOsClient, type EtatAtlasOs } from "@/lib/atlas-os/activation";

// LOT 4 (28/10/2026) — tableau de bord Client, agrégé CÔTÉ SERVEUR.
//
// Remplace les 7 appels simultanés du navigateur (registre OBS-03 : un seul
// appel lent ou en échec bloquait la page sur « Chargement… »). Chaque bloc
// est calculé indépendamment : un bloc en erreur est signalé comme tel
// ({ erreur: true }) sans empêcher l'affichage des autres. Tous les chiffres
// viennent des données du client connecté (clientId de la session), jamais
// de valeurs d'exemple.

export type Bloc<T> = { ok: true; donnees: T } | { ok: false; erreur: true };

async function bloc<T>(nom: string, calcul: () => Promise<T>): Promise<Bloc<T>> {
  try {
    return { ok: true, donnees: await calcul() };
  } catch (e) {
    console.error(`[tableau-de-bord] bloc ${nom} en erreur`, e);
    return { ok: false, erreur: true };
  }
}

export type Compteurs = {
  besoinsEnCours: number;
  besoinsAPreciser: number;
  propositionsAExaminer: number;
  projetsEnCours: number;
  missionsActives: number;
  actionsAFaire: number;
  // LOT 7 (01/11/2026, planche) : précisions affichées sous les indicateurs.
  besoinsCetteSemaine: number;
  actionsPrioritaires: number;
};

export type TacheAFaire = {
  id: string;
  titre: string;
  detail: string;
  priorite: "OBLIGATOIRE" | "PRIORITAIRE" | "A_COMPLETER" | "INFORMATION";
  href: string;
  // REV-11 (01/11/2026) : éléments regroupés dans une tâche (ex. noms des
  // besoins à préciser), pour qu'aucun ne soit perdu dans un résumé.
  elements?: string[];
};

export type EvenementActivite = { id: string; date: string; libelle: string; detail: string | null; href: string };

export type TableauDeBord = {
  client: Bloc<{ nom: string }>;
  compteurs: Bloc<Compteurs>;
  travailAFaire: Bloc<TacheAFaire[]>;
  activite: Bloc<EvenementActivite[]>;
  completude: Bloc<ReturnType<typeof evaluerCompletude>>;
  atlasOs: Bloc<EtatAtlasOs>;
  documents: Bloc<{ id: string; titre: string; createdAt: string }[]>;
};

const PRIORITE_ATTENTION: Record<string, TacheAFaire["priorite"]> = {
  CRITIQUE: "OBLIGATOIRE",
  HAUTE: "PRIORITAIRE",
  MOYENNE: "A_COMPLETER",
  BASSE: "INFORMATION",
};

export async function construireTableauDeBord(clientId: string): Promise<TableauDeBord> {
  // Même synchronisation que la page « Attention » : les attentions dérivées
  // (factures, besoins à clarifier, messages) sont à jour avant lecture.
  const synchro = await bloc("synchronisation", () => synchroniserAttentionsClient(clientId));

  const client = await bloc("client", async () => {
    const c = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: Object.fromEntries(CHAMPS_ENTREPRISE.map((k) => [k, true])) as Record<string, true>,
    });
    return c as unknown as ClientPourCompletude & { nom: string };
  });

  const completude = await bloc("completude", async () => {
    if (!client.ok) throw new Error("client indisponible");
    return evaluerCompletude(client.donnees);
  });

  const atlasOs = await bloc("atlasOs", () => etatAtlasOsClient(clientId));

  const donneesTaches = await bloc("taches", async () => {
    if (!synchro.ok) throw new Error("synchronisation des attentions indisponible");
    const [attentions, feuillesAValider, missionsAEvaluer, profile, propositions] = await Promise.all([
      prisma.attention.findMany({ where: { recipientType: "CLIENT", recipientId: clientId, statut: { in: ["OUVERTE", "LUE"] } } }),
      prisma.feuilleDeTemps.count({ where: { mission: { clientId }, statut: "ValideeAdmin" } }),
      prisma.mission.count({ where: { clientId, statut: "Terminée", evaluation: null } }),
      prisma.clientProfile.findUnique({ where: { clientId }, select: { faits: { select: { statut: true, cle: true } } } }),
      compterPropositionsSansReponse(clientId),
    ]);
    // REV-11 : nom de chaque besoin à préciser (l'attention seule ne le porte
    // pas quand le besoin n'a pas de titre).
    const idsBesoinsAClarifier = attentions.filter((a) => a.type === "BESOIN_A_CLARIFIER").map((a) => a.sourceId);
    const besoinsAClarifier =
      idsBesoinsAClarifier.length > 0
        ? await prisma.clientNeed.findMany({ where: { id: { in: idsBesoinsAClarifier }, clientId }, select: { id: true, titre: true, texteOriginal: true } })
        : [];
    return {
      attentions: attentions.sort(comparerAttentions),
      nomsBesoins: new Map(besoinsAClarifier.map((b) => [b.id, b.titre ?? b.texteOriginal.slice(0, 60)])),
      feuillesAValider,
      missionsAEvaluer,
      faitsAConfirmer: (profile?.faits ?? []).filter((f) => f.statut === "INFERE" || f.statut === "OBSERVE").length,
      propositions,
    };
  });

  const travailAFaire = await bloc("travailAFaire", async () => {
    if (!donneesTaches.ok) throw new Error("tâches indisponibles");
    const d = donneesTaches.donnees;
    const taches: TacheAFaire[] = [];
    if (completude.ok && completude.donnees.prochaineEtape) {
      const etape = completude.donnees.etapes.find((e) => !e.complete)!;
      taches.push({
        id: "completude",
        titre: "Compléter le profil entreprise",
        detail: `Nécessaire pour « ${etape.libelle} » : ${etape.manquants.join(", ")}.`,
        priorite: etape.etape === "QUALIFICATION" ? "OBLIGATOIRE" : "A_COMPLETER",
        href: "/client/profil#entreprise",
      });
    }
    // Une seule tâche pour tous les profils proposés (regroupés par besoin
    // dans l'espace Talents), pour ne pas noyer les autres actions.
    if (d.propositions.total > 0) {
      const nb = d.propositions.total;
      const nbBesoins = d.propositions.parBesoin.length;
      taches.push({
        id: "propositions",
        titre: `Examiner ${nb} profil${nb > 1 ? "s" : ""} proposé${nb > 1 ? "s" : ""}`,
        detail:
          nbBesoins === 1
            ? `Pour votre besoin « ${d.propositions.parBesoin[0].titre} ».`
            : `Pour ${nbBesoins} de vos besoins validés.`,
        priorite: "PRIORITAIRE",
        href: nbBesoins === 1 ? `/client/talent#besoin-${d.propositions.parBesoin[0].besoinId}` : "/client/talent",
      });
    }
    // REV-11 : les besoins à préciser sont regroupés en UNE tâche nommant
    // chacun d'eux (plus jamais 16 lignes identiques sans nom).
    const clarifications = d.attentions.filter((a) => a.type === "BESOIN_A_CLARIFIER");
    if (clarifications.length > 0) {
      const noms = clarifications.map((a) => d.nomsBesoins.get(a.sourceId) ?? "Besoin sans titre");
      const n = noms.length;
      const premiers = noms.slice(0, 2).map((x) => `« ${x} »`).join(", ");
      taches.push({
        id: n === 1 ? `attention-${clarifications[0].id}` : "besoins-a-preciser",
        titre: n === 1 ? `Préciser le besoin « ${noms[0]} »` : `${n} besoins à préciser`,
        detail: n === 1 ? clarifications[0].resume : `${premiers}${n > 2 ? ` et ${n - 2} autre${n - 2 > 1 ? "s" : ""}` : ""} : des informations complémentaires sont attendues.`,
        priorite: "A_COMPLETER",
        href: "/client/besoins",
        elements: noms,
      });
    }
    for (const a of d.attentions.filter((x) => x.type !== "BESOIN_A_CLARIFIER")) {
      const action = a.actionDisponible as { label?: string; href?: string } | null;
      taches.push({
        id: `attention-${a.id}`,
        titre: a.titre,
        detail: a.resume,
        priorite: PRIORITE_ATTENTION[a.priorite] ?? "INFORMATION",
        href: action?.href ?? "/client/attentions",
      });
    }
    if (d.feuillesAValider > 0) {
      taches.push({ id: "feuilles", titre: `${d.feuillesAValider} feuille${d.feuillesAValider > 1 ? "s" : ""} de temps à valider`, detail: "Validées par notre équipe, en attente de votre validation.", priorite: "PRIORITAIRE", href: "/client/finance" });
    }
    if (d.missionsAEvaluer > 0) {
      taches.push({ id: "evaluations", titre: `${d.missionsAEvaluer} mission${d.missionsAEvaluer > 1 ? "s" : ""} terminée${d.missionsAEvaluer > 1 ? "s" : ""} à évaluer`, detail: "Votre évaluation aide à proposer les bons profils.", priorite: "A_COMPLETER", href: "/client/missions" });
    }
    if (d.faitsAConfirmer > 0) {
      taches.push({ id: "profil-a-confirmer", titre: `${d.faitsAConfirmer} information${d.faitsAConfirmer > 1 ? "s" : ""} de profil à confirmer`, detail: "Déduites par ATLAS de votre activité : confirmez-les ou corrigez-les.", priorite: "A_COMPLETER", href: "/client/profil" });
    }
    // Ordre : priorité décroissante, puis ordre d'insertion (stable).
    const rang: Record<TacheAFaire["priorite"], number> = { OBLIGATOIRE: 0, PRIORITAIRE: 1, A_COMPLETER: 2, INFORMATION: 3 };
    return taches.map((t, i) => ({ t, i })).sort((a, b) => rang[a.t.priorite] - rang[b.t.priorite] || a.i - b.i).map(({ t }) => t);
  });

  const compteurs = await bloc("compteurs", async () => {
    const [besoins, missionsActives, projetsEnCours, besoinsCetteSemaine] = await Promise.all([
      prisma.clientNeed.groupBy({ by: ["statut"], where: { clientId }, _count: { _all: true } }),
      prisma.mission.count({ where: { clientId, statut: "En cours" } }),
      compterProjetsEnCours(clientId),
      prisma.clientNeed.count({ where: { clientId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    ]);
    const parStatut = Object.fromEntries(besoins.map((b) => [b.statut, b._count._all])) as Record<string, number>;
    return {
      besoinsEnCours: (parStatut.SOUMIS ?? 0) + (parStatut.A_CLARIFIER ?? 0) + (parStatut.VALIDE ?? 0),
      besoinsAPreciser: parStatut.A_CLARIFIER ?? 0,
      propositionsAExaminer: donneesTaches.ok ? donneesTaches.donnees.propositions.total : 0,
      projetsEnCours,
      missionsActives,
      actionsAFaire: travailAFaire.ok ? travailAFaire.donnees.length : 0,
      besoinsCetteSemaine,
      actionsPrioritaires: travailAFaire.ok ? travailAFaire.donnees.filter((t) => t.priorite === "OBLIGATOIRE" || t.priorite === "PRIORITAIRE").length : 0,
    };
  });

  const activite = await bloc("activite", () => construireActivite(clientId));

  const documents = await bloc("documents", async () =>
    (await prisma.document.findMany({ where: { clientId }, select: { id: true, titre: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 })).map((d) => ({
      id: d.id,
      titre: d.titre,
      createdAt: d.createdAt.toISOString(),
    }))
  );

  return {
    client: client.ok ? { ok: true, donnees: { nom: client.donnees.nom } } : client,
    compteurs,
    travailAFaire,
    activite,
    completude,
    atlasOs,
    documents,
  };
}

// Projets (LOT 6) : comptés seulement si le module est présent en base.
async function compterProjetsEnCours(clientId: string): Promise<number> {
  return prisma.projet.count({ where: { clientId, statut: { notIn: ["TERMINE", "ABANDONNE"] } } });
}

const LIBELLE_ACTION_TALENT: Record<string, string> = {
  POURSUIVRE: "Vous souhaitez poursuivre avec un profil proposé",
  NE_PAS_RETENIR: "Profil proposé non retenu",
  AUTRES_PROFILS: "Demande de profils supplémentaires",
};

async function construireActivite(clientId: string): Promise<EvenementActivite[]> {
  const [besoins, messages, actions, missions, documents] = await Promise.all([
    prisma.clientNeed.findMany({ where: { clientId }, select: { id: true, titre: true, texteOriginal: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.message.findMany({ where: { clientId }, select: { id: true, auteurRole: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.actionTalentClient.findMany({ where: { clientId }, select: { id: true, type: true, needId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.mission.findMany({ where: { clientId }, select: { id: true, repere: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.document.findMany({ where: { clientId }, select: { id: true, titre: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const evenements: EvenementActivite[] = [
    ...besoins.map((b) => ({ id: `b-${b.id}`, date: b.createdAt.toISOString(), libelle: "Besoin exprimé", detail: b.titre ?? b.texteOriginal.slice(0, 60), href: "/client/besoins" })),
    ...messages.map((m) => ({
      id: `m-${m.id}`,
      date: m.createdAt.toISOString(),
      libelle: m.auteurRole === "CLIENT" ? "Message envoyé à l'équipe ATLAS" : "Message reçu de l'équipe ATLAS",
      detail: null,
      href: "/client/communication",
    })),
    ...actions.map((a) => ({ id: `a-${a.id}`, date: a.createdAt.toISOString(), libelle: LIBELLE_ACTION_TALENT[a.type] ?? "Action sur un profil", detail: null, href: `/client/talent#besoin-${a.needId}` })),
    ...missions.map((m) => ({ id: `mi-${m.id}`, date: m.createdAt.toISOString(), libelle: "Mission démarrée", detail: m.repere, href: "/client/missions" })),
    ...documents.map((d) => ({ id: `d-${d.id}`, date: d.createdAt.toISOString(), libelle: "Nouveau document", detail: d.titre, href: "/client/documents" })),
  ];
  return evenements.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
}
