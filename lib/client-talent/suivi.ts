import { Prisma } from "@prisma/client";
import { verifierCompletudeClient, messageCompletude } from "@/lib/client-profile/completude-serveur";
import { prisma } from "@/lib/prisma";
import {
  calculerEmpreinteVivier,
  chargerVivier,
  derniereVague,
  ligneVersVue,
  obtenirSolutions,
  signatureDe,
  type EtatRecherche,
  type Vivier,
} from "@/lib/client-solution/generation";
import { suggererCriteresDemande } from "@/lib/client-need/talent-bridge";
import { calculerSignatureSource } from "@/lib/client-solution/signature";
import type { SolutionOptionVue } from "@/lib/client-solution/persistence-types";

// LOT 2 (28/10/2026) — Espace Talents du Client : suivi des profils
// PROPOSÉS pour ses besoins, jamais un catalogue d'ingénieurs.
//
// Deux sources, toutes deux anonymes côté Client :
//   1. les options C3 de la recherche mémorisée d'un besoin VALIDÉ
//      (lib/client-solution/generation.ts — matching + admissibilité) ;
//   2. les entrées de shortlist qu'un Admin a explicitement VALIDÉES pour la
//      demande Talent issue de ce besoin (ShortlistEntree, statut VALIDEE).
//
// REV-02 (01/11/2026) — PERFORMANCE : l'affichage de la liste est en LECTURE
// SEULE et coûte un nombre FIXE de requêtes (une dizaine), quel que soit le
// nombre de besoins : aucune recherche n'est lancée ici. Un besoin dont la
// recherche n'est plus à jour (critères ou vivier modifiés) est signalé
// `A_ACTUALISER` ; l'interface demande alors son actualisation
// (actualiserSuiviTalents, 5 besoins au plus par appel, vivier chargé une
// seule fois).
//
// REV (01/11/2026) — LIMITE STRICTE : au plus 5 profils par besoin, toutes
// sources confondues, sans doublon (un même ingénieur proposé par le matching
// et par l'équipe n'apparaît qu'une fois). Les profils proposés par l'équipe
// ATLAS passent en premier ; un profil « non retenu » cède sa place quand un
// autre profil est disponible.
//
// Garanties : aucun identifiant de profil, nom, prénom, e-mail, téléphone,
// TJM ou score interne n'est renvoyé (l'identifiant interne sert uniquement,
// côté serveur, à dédoublonner et à rattacher les décisions) ; seules les
// compétences VÉRIFIÉES d'une entrée de shortlist sont montrées ; un client ne
// voit que ses propres besoins (clientId toujours issu de la session).
// Les besoins qui portent un PROJET (lot 6) ne sont pas proposés ici : un
// projet est traité par l'équipe ATLAS, pas par sélection de profils.

export const PROFILS_MAX_PAR_BESOIN = 5;
export const ACTUALISATIONS_MAX_PAR_APPEL = 5;

export type CibleAction = { solutionOptionId?: string; shortlistEntreeId?: string };

export type EtatAction = {
  type: "POURSUIVRE" | "NE_PAS_RETENIR";
  statut: "ENVOYEE" | "PRISE_EN_CHARGE" | "CLOTUREE";
  le: string;
};

export type ProfilPropose = {
  cle: string; // identifiant de la proposition (option ou entrée de shortlist), jamais celui du profil
  libelle: string; // « Profil A », « Profil B »…
  origine: "MATCHING" | "EQUIPE_ATLAS";
  niveauCorrespondance: "FORTE" | "PARTIELLE" | null;
  niveauConfiance: SolutionOptionVue["niveauConfiance"] | null;
  competencesCorrespondantes: string[];
  competencesManquantes: string[];
  criteresAPreciser: string[];
  disponibilite: string | null;
  seniorite: string | null;
  anneesExperience: number | null;
  justification: string | null;
  recommande: boolean;
  cible: CibleAction;
  derniereAction: EtatAction | null;
};

export type SuiviBesoin = {
  besoinId: string;
  titre: string;
  statutBesoin: string;
  eligible: boolean;
  raison: string | null;
  // REV-02 : A_JOUR = profils issus de la dernière recherche ; A_ACTUALISER =
  // critères ou vivier modifiés depuis, recherche à relancer.
  etatRecherche: EtatRecherche;
  profils: ProfilPropose[];
  demandesAutresProfils: { le: string; statut: EtatAction["statut"]; commentaire: string | null }[];
};

const LETTRES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function libelleProfil(rang: number): string {
  return `Profil ${LETTRES[rang] ?? String(rang + 1)}`;
}

type LigneAction = {
  id: string;
  needId: string;
  type: string;
  statut: string;
  solutionOptionId: string | null;
  shortlistEntreeId: string | null;
  commentaire: string | null;
  createdAt: Date;
};

// Interne : un profil proposé avec son identifiant de profil (SERVEUR
// UNIQUEMENT, retiré avant toute réponse).
type Candidat = { profilId: string | null; vue: Omit<ProfilPropose, "libelle" | "derniereAction"> };
type ProjectionBesoin = { suivi: SuiviBesoin; profilsInternes: { cle: string; profilId: string | null }[] };

const STATUTS_OUVERTS = ["ENVOYEE", "PRISE_EN_CHARGE"];

// Lecture groupée (nombre fixe de requêtes) de l'état Talents des besoins
// demandés — aucune recherche, aucune écriture.
async function projeterBesoins(clientId: string, filtreBesoins?: string[]): Promise<ProjectionBesoin[]> {
  const besoins = await prisma.clientNeed.findMany({
    where: { clientId, statut: "VALIDE", projet: { is: null }, ...(filtreBesoins ? { id: { in: filtreBesoins } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, titre: true, texteOriginal: true, statut: true, faits: true },
  });
  if (besoins.length === 0) return [];
  const ids = besoins.map((b) => b.id);

  const [empreinteVivier, vagues, actions, entrees] = await Promise.all([
    calculerEmpreinteVivier(),
    prisma.solutionVague.findMany({ where: { needId: { in: ids } }, orderBy: [{ needId: "asc" }, { createdAt: "desc" }], distinct: ["needId"] }),
    prisma.actionTalentClient.findMany({ where: { clientId, needId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    prisma.shortlistEntree.findMany({
      where: { statut: "VALIDEE", demande: { clientId, sourceNeedId: { in: ids } } },
      orderBy: { score: "desc" },
      select: {
        id: true,
        profilId: true,
        demande: { select: { sourceNeedId: true } },
        profil: {
          select: {
            seniorite: true,
            anneesExperience: true,
            disponibilite: true,
            competencesGraph: { where: { statut: "VERIFIE" }, select: { competence: true } },
          },
        },
      },
    }),
  ]);
  const vagueParBesoin = new Map(vagues.map((v) => [v.needId, v]));
  const sansVague = ids.filter((id) => !vagueParBesoin.has(id));

  const [lignesVagues, lignesHistoriques] = await Promise.all([
    prisma.solutionOption.findMany({ where: { id: { in: vagues.flatMap((v) => v.optionIds) } } }),
    sansVague.length > 0
      ? prisma.solutionOption.findMany({ where: { needId: { in: sansVague }, clientId, niveau: { in: ["OPTION", "RECOMMANDATION"] } }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  const ligneParId = new Map(lignesVagues.map((l) => [l.id, l]));

  // Correspondances internes option -> profil (options affichées ET options
  // visées par une décision passée), pour dédoublonner et rattacher les
  // décisions d'une vague à l'autre. Jamais renvoyées au Client.
  const idsOptionsInternes = [
    ...lignesVagues.map((l) => l.id),
    ...lignesHistoriques.map((l) => l.id),
    ...actions.map((a) => a.solutionOptionId).filter((x): x is string => Boolean(x)),
  ];
  const entreesActions = actions.map((a) => a.shortlistEntreeId).filter((x): x is string => Boolean(x));
  const [internes, entreesVisees] = await Promise.all([
    idsOptionsInternes.length > 0 ? prisma.solutionOptionProfilInterne.findMany({ where: { solutionOptionId: { in: idsOptionsInternes } } }) : Promise.resolve([]),
    entreesActions.length > 0 ? prisma.shortlistEntree.findMany({ where: { id: { in: entreesActions } }, select: { id: true, profilId: true } }) : Promise.resolve([]),
  ]);
  const profilDeCible = new Map<string, string>([
    ...internes.map((i) => [i.solutionOptionId, i.profilId] as [string, string]),
    ...entrees.map((e) => [e.id, e.profilId] as [string, string]),
    ...entreesVisees.map((e) => [e.id, e.profilId] as [string, string]),
  ]);

  return besoins.map((besoin) => {
    const signature = calculerSignatureSource(suggererCriteresDemande(besoin.faits));
    const vague = vagueParBesoin.get(besoin.id);
    let lignes: typeof lignesVagues;
    let etatRecherche: EtatRecherche;
    if (vague) {
      const memesCriteres = vague.signatureCriteres === signature;
      lignes = memesCriteres ? vague.optionIds.map((id) => ligneParId.get(id)).filter((l): l is (typeof lignesVagues)[number] => Boolean(l)) : [];
      etatRecherche = memesCriteres && vague.empreinteVivier === empreinteVivier ? "A_JOUR" : "A_ACTUALISER";
    } else {
      const historiques = lignesHistoriques.filter((l) => l.needId === besoin.id);
      lignes = historiques.length > 0 && signatureDe(historiques[0]) === signature ? derniereVague(historiques, signature) : [];
      etatRecherche = "A_ACTUALISER";
    }
    const vues = lignes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(ligneVersVue);
    const options = vues.filter((v) => v.niveau === "OPTION");
    const recommandeId = vues.find((v) => v.niveau === "RECOMMANDATION")?.sourceOptionId ?? null;

    const candidats: Candidat[] = [];
    // 1. Profils proposés et validés par l'équipe ATLAS.
    for (const entree of entrees.filter((e) => e.demande.sourceNeedId === besoin.id)) {
      candidats.push({
        profilId: entree.profilId,
        vue: {
          cle: entree.id,
          origine: "EQUIPE_ATLAS",
          niveauCorrespondance: null,
          niveauConfiance: null,
          competencesCorrespondantes: [...new Set(entree.profil.competencesGraph.map((c) => c.competence))].sort(),
          competencesManquantes: [],
          criteresAPreciser: [],
          disponibilite: entree.profil.disponibilite ?? null,
          seniorite: entree.profil.seniorite ?? null,
          anneesExperience: entree.profil.anneesExperience ?? null,
          justification: null,
          recommande: false,
          cible: { shortlistEntreeId: entree.id },
        },
      });
    }
    // 2. Profils issus de la recherche (matching), dans l'ordre de la vague.
    for (const option of options) {
      candidats.push({
        profilId: profilDeCible.get(option.id) ?? null,
        vue: {
          cle: option.id,
          origine: "MATCHING",
          niveauCorrespondance: option.niveauCorrespondance ?? null,
          niveauConfiance: option.niveauConfiance,
          competencesCorrespondantes: option.competencesCorrespondantes,
          competencesManquantes: option.competencesManquantes ?? [],
          criteresAPreciser: option.criteresAPreciser,
          disponibilite: option.disponibilite.statut === "CONNUE" ? option.disponibilite.detail : null,
          seniorite: null,
          anneesExperience: null,
          justification: option.justification || null,
          recommande: option.id === recommandeId,
          cible: { solutionOptionId: option.id },
        },
      });
    }

    // Dédoublonnage : un même ingénieur n'est jamais proposé deux fois.
    const vus = new Set<string>();
    const uniques = candidats.filter((c) => {
      if (!c.profilId) return true;
      if (vus.has(c.profilId)) return false;
      vus.add(c.profilId);
      return true;
    });

    // Décisions du Client, rattachées par proposition ou par profil.
    const actionsBesoin = actions.filter((a) => a.needId === besoin.id);
    const derniereActionPour = (c: Candidat): EtatAction | null => {
      const visees = actionsBesoin.filter((a) => {
        if (a.type !== "POURSUIVRE" && a.type !== "NE_PAS_RETENIR") return false;
        const cibleId = a.solutionOptionId ?? a.shortlistEntreeId;
        if (!cibleId) return false;
        if (cibleId === c.vue.cle) return true;
        const profil = profilDeCible.get(cibleId);
        return Boolean(c.profilId && profil && profil === c.profilId);
      });
      const derniere = visees[visees.length - 1];
      return derniere ? { type: derniere.type as EtatAction["type"], statut: derniere.statut as EtatAction["statut"], le: derniere.createdAt.toISOString() } : null;
    };

    // Limite stricte : 5 profils au plus. Un profil non retenu cède sa place
    // s'il y a d'autres profils ; l'ordre d'affichage reste celui des sources.
    const avecAction = uniques.map((c, rang) => ({ c, rang, action: derniereActionPour(c) }));
    const retenus = [...avecAction]
      .sort((a, b) => Number(a.action?.type === "NE_PAS_RETENIR") - Number(b.action?.type === "NE_PAS_RETENIR") || a.rang - b.rang)
      .slice(0, PROFILS_MAX_PAR_BESOIN)
      .sort((a, b) => a.rang - b.rang);

    const profils: ProfilPropose[] = retenus.map(({ c, action }, i) => ({ ...c.vue, libelle: libelleProfil(i), derniereAction: action }));
    return {
      suivi: {
        besoinId: besoin.id,
        titre: besoin.titre ?? besoin.texteOriginal.slice(0, 80),
        statutBesoin: besoin.statut,
        eligible: true,
        raison: null,
        etatRecherche,
        profils,
        demandesAutresProfils: actionsBesoin
          .filter((a) => a.type === "AUTRES_PROFILS")
          .map((a) => ({ le: a.createdAt.toISOString(), statut: a.statut as EtatAction["statut"], commentaire: a.commentaire })),
      },
      profilsInternes: retenus.map(({ c }) => ({ cle: c.vue.cle, profilId: c.profilId })),
    };
  });
}

// Affichage de la page Talents : LECTURE SEULE (voir en-tête).
export async function chargerSuiviTalents(clientId: string, filtreBesoins?: string[]): Promise<SuiviBesoin[]> {
  return (await projeterBesoins(clientId, filtreBesoins)).map((p) => p.suivi);
}

// Actualisation explicite de quelques besoins (5 au plus) : le vivier est
// chargé UNE fois et partagé ; un besoin déjà à jour n'est pas recalculé.
export async function actualiserSuiviTalents(clientId: string, needIds: string[]): Promise<SuiviBesoin[]> {
  const ids = [...new Set(needIds)].slice(0, ACTUALISATIONS_MAX_PAR_APPEL);
  const besoins = await prisma.clientNeed.findMany({ where: { id: { in: ids }, clientId, statut: "VALIDE", projet: { is: null } }, select: { id: true } });
  if (besoins.length === 0) return [];
  const empreinteVivier = await calculerEmpreinteVivier();
  let vivier: Promise<Vivier> | null = null;
  const vivierPartage = () => (vivier ??= chargerVivier());
  for (const b of besoins) {
    await obtenirSolutions(b.id, clientId, { calcul: true, empreinteVivier, vivier: vivierPartage });
  }
  return chargerSuiviTalents(
    clientId,
    besoins.map((b) => b.id)
  );
}

export type ResultatAction = { ok: true; id: string } | { ok: false; code: 400 | 404 | 409; erreur: string; manquants?: string[] };

class ActionDejaOuverte extends Error {
  constructor(public message: string) {
    super(message);
  }
}

export async function enregistrerActionTalent(params: {
  clientId: string;
  email: string;
  needId: string;
  type: "POURSUIVRE" | "NE_PAS_RETENIR" | "AUTRES_PROFILS";
  cible: CibleAction;
  commentaire: string | null;
}): Promise<ResultatAction> {
  const besoin = await prisma.clientNeed.findFirst({ where: { id: params.needId, clientId: params.clientId }, select: { id: true, statut: true, projet: { select: { id: true } } } });
  if (!besoin) return { ok: false, code: 404, erreur: "Besoin introuvable." };
  if (besoin.projet) return { ok: false, code: 409, erreur: "Ce besoin porte un projet : il se suit depuis l'onglet Projets." };
  if (besoin.statut !== "VALIDE") return { ok: false, code: 409, erreur: "Validez d'abord ce besoin." };

  let solutionOptionId: string | null = null;
  let shortlistEntreeId: string | null = null;
  let profilVise: string | null = null;

  if (params.type === "AUTRES_PROFILS") {
    if (params.cible.solutionOptionId || params.cible.shortlistEntreeId) {
      return { ok: false, code: 400, erreur: "Une demande de profils supplémentaires ne vise aucun profil précis." };
    }
  } else {
    const nbCibles = Number(Boolean(params.cible.solutionOptionId)) + Number(Boolean(params.cible.shortlistEntreeId));
    if (nbCibles !== 1) return { ok: false, code: 400, erreur: "Indiquez exactement un profil proposé." };
    // REV (01/11/2026) : seule une proposition ACTUELLEMENT affichée au Client
    // (5 au plus, voir projeterBesoins) peut faire l'objet d'une décision.
    const [projection] = await projeterBesoins(params.clientId, [besoin.id]);
    const cle = params.cible.solutionOptionId ?? params.cible.shortlistEntreeId!;
    const affiche = projection?.profilsInternes.find((p) => p.cle === cle);
    const vue = projection?.suivi.profils.find((p) => p.cle === cle);
    if (!affiche || !vue || (params.cible.solutionOptionId && !vue.cible.solutionOptionId) || (params.cible.shortlistEntreeId && !vue.cible.shortlistEntreeId)) {
      return { ok: false, code: 404, erreur: "Profil proposé introuvable." };
    }
    // LOT 3 : poursuivre engage la suite vers une contractualisation — le
    // profil entreprise doit contenir les informations de cette étape.
    if (params.type === "POURSUIVRE") {
      const completude = await verifierCompletudeClient(params.clientId, "CONTRACTUALISATION");
      if (!completude.ok) return { ok: false, code: 409, erreur: messageCompletude(completude.manquants), manquants: completude.manquants };
    }
    solutionOptionId = vue.cible.solutionOptionId ?? null;
    shortlistEntreeId = vue.cible.shortlistEntreeId ?? null;
    profilVise = affiche.profilId;
  }

  // Unicité garantie en transaction Serializable (aucun doublon même sur
  // deux clics simultanés) : une seule demande « autres profils » ouverte par
  // besoin ; une seule décision ouverte par profil proposé.
  for (let tentative = 0; tentative < 3; tentative++) {
    try {
      const action = await prisma.$transaction(
        async (tx) => {
          const ouvertes = await tx.actionTalentClient.findMany({
            where: { needId: besoin.id, clientId: params.clientId, statut: { in: STATUTS_OUVERTS as ("ENVOYEE" | "PRISE_EN_CHARGE")[] } },
          });
          if (params.type === "AUTRES_PROFILS") {
            if (ouvertes.some((a) => a.type === "AUTRES_PROFILS")) throw new ActionDejaOuverte("Une demande de profils supplémentaires est déjà en cours pour ce besoin.");
          } else {
            const decisions = ouvertes.filter((a) => a.type === "POURSUIVRE" || a.type === "NE_PAS_RETENIR");
            const ciblesOuvertes = decisions.map((a) => a.solutionOptionId ?? a.shortlistEntreeId).filter((x): x is string => Boolean(x));
            const memeCible = ciblesOuvertes.includes((solutionOptionId ?? shortlistEntreeId)!);
            let memeProfil = false;
            if (!memeCible && profilVise && ciblesOuvertes.length > 0) {
              const [internes, entreesShortlist] = await Promise.all([
                tx.solutionOptionProfilInterne.findMany({ where: { solutionOptionId: { in: ciblesOuvertes } } }),
                tx.shortlistEntree.findMany({ where: { id: { in: ciblesOuvertes } }, select: { profilId: true } }),
              ]);
              memeProfil = [...internes.map((i) => i.profilId), ...entreesShortlist.map((e) => e.profilId)].includes(profilVise);
            }
            if (memeCible || memeProfil) {
              throw new ActionDejaOuverte("Votre décision sur ce profil est déjà en cours de traitement par l'équipe ATLAS.");
            }
          }
          return tx.actionTalentClient.create({
            data: {
              clientId: params.clientId,
              needId: besoin.id,
              type: params.type,
              solutionOptionId,
              shortlistEntreeId,
              commentaire: params.commentaire,
              creeParEmail: params.email,
            },
            select: { id: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      return { ok: true, id: action.id };
    } catch (e) {
      if (e instanceof ActionDejaOuverte) return { ok: false, code: 409, erreur: e.message };
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034" && tentative < 2) continue;
      throw e;
    }
  }
  return { ok: false, code: 409, erreur: "Demande concurrente : réessayez." };
}

// LOT 4 (28/10/2026) — pour le tableau de bord : nombre de profils proposés
// (au plus 5 par besoin, mêmes règles que la page Talents) sans réponse du
// Client. LECTURE SEULE : ne déclenche jamais de recherche.
export async function compterPropositionsSansReponse(clientId: string): Promise<{ total: number; parBesoin: { besoinId: string; titre: string; nombre: number }[] }> {
  const parBesoin = (await projeterBesoins(clientId))
    .map(({ suivi }) => ({ besoinId: suivi.besoinId, titre: suivi.titre.slice(0, 60), nombre: suivi.profils.filter((p) => p.derniereAction === null).length }))
    .filter((b) => b.nombre > 0);
  return { total: parBesoin.reduce((n, b) => n + b.nombre, 0), parBesoin };
}
