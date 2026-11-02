import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { preparerNouveauBesoin } from "@/lib/client-need/creation";
import { valeursActuellesRepetables } from "@/lib/client-need/faits";
import { verifierCompletudeClient, messageCompletude } from "@/lib/client-profile/completude-serveur";
import { exigerAtlasOsActif } from "@/lib/atlas-os/activation";
import {
  informationsManquantes,
  statutApresPublication,
  STATUTS_PERMETTANT_PUBLICATION,
  transitionAutorisee,
  validerProposition,
  type ContenuProposition,
  type StatutProjetValeur,
} from "./regles";

// LOT 6 (28/10/2026) — PROJETS COMPLETS : orchestration (Prisma). Toute la
// logique de décision est dans lib/projet/regles.ts (pure). Un projet naît
// d'un ClientNeed (même extraction, mêmes faits) et aboutit à des Missions
// existantes : aucun système de gestion de projet parallèle.

export type Resultat<T = object> = ({ ok: true } & T) | { ok: false; code: 400 | 403 | 404 | 409; erreur: string; manquants?: string[] };

const LIMITES = { titre: 200, court: 2000, long: 4000 };

function texte(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export type SaisieProjet = {
  type: "DELIVERY" | "SERVICE_ATLAS_OS";
  titre: string | null;
  objectif: string | null;
  resultatAttendu: string | null;
  perimetre: string | null;
  contraintes: string | null;
  exigencesTechniques: string | null;
  calendrierSouhaite: string | null;
  budgetIndicatif: string | null;
};

export function lireSaisieProjet(body: Record<string, unknown> | null): SaisieProjet {
  return {
    type: body?.type === "SERVICE_ATLAS_OS" ? "SERVICE_ATLAS_OS" : "DELIVERY",
    titre: texte(body?.titre, LIMITES.titre),
    objectif: texte(body?.objectif, LIMITES.court),
    resultatAttendu: texte(body?.resultatAttendu, LIMITES.court),
    perimetre: texte(body?.perimetre, LIMITES.long),
    contraintes: texte(body?.contraintes, LIMITES.court),
    exigencesTechniques: texte(body?.exigencesTechniques, LIMITES.court),
    calendrierSouhaite: texte(body?.calendrierSouhaite, 500),
    budgetIndicatif: texte(body?.budgetIndicatif, 500),
  };
}

function texteComposite(s: SaisieProjet): string {
  const lignes = [
    s.titre,
    `Objectif : ${s.objectif}`,
    `Résultat attendu : ${s.resultatAttendu}`,
    s.perimetre && `Périmètre : ${s.perimetre}`,
    s.contraintes && `Contraintes : ${s.contraintes}`,
    s.exigencesTechniques && `Exigences techniques : ${s.exigencesTechniques}`,
    s.calendrierSouhaite && `Calendrier souhaité : ${s.calendrierSouhaite}`,
    s.budgetIndicatif && `Budget indicatif : ${s.budgetIndicatif}`,
  ];
  return lignes.filter(Boolean).join("\n").slice(0, 4000);
}

export async function creerProjet(clientId: string, email: string, s: SaisieProjet): Promise<Resultat<{ id: string }>> {
  if (!s.titre || !s.objectif || !s.resultatAttendu) {
    return { ok: false, code: 400, erreur: "Titre, objectif et résultat attendu sont requis." };
  }
  const completude = await verifierCompletudeClient(clientId, "QUALIFICATION");
  if (!completude.ok) return { ok: false, code: 409, erreur: messageCompletude(completude.manquants), manquants: completude.manquants };
  if (s.type === "SERVICE_ATLAS_OS" && !(await exigerAtlasOsActif(clientId))) {
    return { ok: false, code: 403, erreur: "Les prestations ATLAS OS nécessitent l'activation du module ATLAS OS (rubrique ATLAS OS)." };
  }

  // Même moteur d'analyse que les besoins (extraction, faits, cohérence),
  // préparé AVANT la transaction (aucune requête hors `tx` dedans).
  const besoin = await preparerNouveauBesoin({
    clientId,
    texteOriginal: texteComposite(s),
    titre: s.titre,
    faitsSupplementaires: [
      { cle: "OBJECTIF", valeur: s.objectif, source: "client_projet" },
      { cle: "RESULTAT_ATTENDU", valeur: s.resultatAttendu, source: "client_projet" },
    ],
  });

  const projet = await prisma.$transaction(async (tx) => {
    const need = await tx.clientNeed.create({ data: besoin, select: { id: true } });
    const cree = await tx.projet.create({
      data: {
        clientId,
        needId: need.id,
        type: s.type,
        titre: s.titre!,
        objectif: s.objectif!,
        resultatAttendu: s.resultatAttendu!,
        perimetre: s.perimetre,
        contraintes: s.contraintes,
        exigencesTechniques: s.exigencesTechniques,
        calendrierSouhaite: s.calendrierSouhaite,
        budgetIndicatif: s.budgetIndicatif,
      },
      select: { id: true },
    });
    await tx.evenementProjet.create({ data: { projetId: cree.id, type: "CREATION", acteurEmail: email, acteurRole: "CLIENT" } });
    return cree;
  });
  return { ok: true, id: projet.id };
}

const INCLUSION_DETAIL = {
  need: { select: { faits: { select: { cle: true, valeur: true, statut: true, createdAt: true } } } },
  propositions: { orderBy: { version: "desc" as const } },
  evenements: { orderBy: { createdAt: "desc" as const } },
  missions: { select: { id: true, repere: true, statut: true, dateDebut: true, dateFin: true } },
} satisfies Prisma.ProjetInclude;

type ProjetDetaille = Prisma.ProjetGetPayload<{ include: typeof INCLUSION_DETAIL }>;

// Vue CLIENT : les brouillons de proposition ne sont jamais montrés ; les
// rôles d'équipe sont des rôles ENVISAGÉS (aucune personne nommée).
function vueClient(p: ProjetDetaille) {
  const manquants = informationsManquantes(p);
  return {
    id: p.id,
    type: p.type,
    titre: p.titre,
    objectif: p.objectif,
    resultatAttendu: p.resultatAttendu,
    perimetre: p.perimetre,
    contraintes: p.contraintes,
    exigencesTechniques: p.exigencesTechniques,
    calendrierSouhaite: p.calendrierSouhaite,
    budgetIndicatif: p.budgetIndicatif,
    statut: p.statut,
    createdAt: p.createdAt.toISOString(),
    manquants,
    competencesIdentifiees: valeursActuellesRepetables(p.need.faits, "COMPETENCE").map((f) => f.valeur),
    propositions: p.propositions
      .filter((x) => x.statut !== "BROUILLON")
      .map((x) => ({
        id: x.id,
        version: x.version,
        niveau: x.niveau,
        statut: x.statut,
        approche: x.approche,
        perimetre: x.perimetre,
        equipe: x.equipe,
        etapes: x.etapes,
        delaiEstime: x.delaiEstime,
        budgetEstimeMin: x.budgetEstimeMin,
        budgetEstimeMax: x.budgetEstimeMax,
        devise: x.devise,
        hypotheses: x.hypotheses,
        exclusions: x.exclusions,
        publieeLe: x.publieeLe?.toISOString() ?? null,
        verifieeLe: x.verifieeLe?.toISOString() ?? null,
        decisionLe: x.decisionLe?.toISOString() ?? null,
      })),
    evenements: p.evenements.map((e) => ({
      id: e.id,
      type: e.type,
      detail: e.detail,
      auteur: e.acteurRole === "CLIENT" ? "Vous" : "Équipe ATLAS",
      le: e.createdAt.toISOString(),
      statutTraitement: e.statutTraitement,
    })),
    missions: p.missions,
  };
}

export async function listerProjetsClient(clientId: string) {
  const projets = await prisma.projet.findMany({ where: { clientId }, include: INCLUSION_DETAIL, orderBy: { createdAt: "desc" } });
  return projets.map(vueClient);
}

async function projetDuClient(clientId: string, projetId: string) {
  return prisma.projet.findFirst({ where: { id: projetId, clientId } });
}

// Le Client complète son projet tant qu'aucune proposition n'est en jeu.
export async function completerProjet(clientId: string, email: string, projetId: string, body: Record<string, unknown> | null): Promise<Resultat> {
  const projet = await projetDuClient(clientId, projetId);
  if (!projet) return { ok: false, code: 404, erreur: "Projet introuvable." };
  if (projet.statut !== "A_QUALIFIER" && projet.statut !== "QUALIFIE") {
    return { ok: false, code: 409, erreur: "Une proposition est en cours : demandez un ajustement du périmètre depuis la proposition." };
  }
  const champs = ["objectif", "resultatAttendu", "perimetre", "contraintes", "exigencesTechniques", "calendrierSouhaite", "budgetIndicatif"] as const;
  const data: Record<string, string | null> = {};
  for (const c of champs) {
    if (body && c in body) {
      const v = texte(body[c], c === "perimetre" ? LIMITES.long : LIMITES.court);
      if ((c === "objectif" || c === "resultatAttendu") && !v) return { ok: false, code: 400, erreur: "L'objectif et le résultat attendu ne peuvent pas être vides." };
      data[c] = v;
    }
  }
  if (Object.keys(data).length === 0) return { ok: false, code: 400, erreur: "Aucune modification fournie." };
  const maj = await prisma.projet.updateMany({ where: { id: projet.id, clientId, statut: projet.statut }, data });
  if (maj.count === 0) return { ok: false, code: 409, erreur: "Le projet a changé entre-temps, rechargez la page." };
  await prisma.evenementProjet.create({ data: { projetId: projet.id, type: "COMPLEMENT_CLIENT", detail: `Champs complétés : ${Object.keys(data).join(", ")}`, acteurEmail: email, acteurRole: "CLIENT" } });
  return { ok: true };
}

export type ActionClientProjet = "INTERET" | "DEMANDE_PRECISION" | "ACCEPTER" | "DECLINER" | "ABANDONNER";

export async function actionClientProjet(params: {
  clientId: string;
  email: string;
  projetId: string;
  action: ActionClientProjet;
  propositionId: string | null;
  message: string | null;
}): Promise<Resultat> {
  const projet = await projetDuClient(params.clientId, params.projetId);
  if (!projet) return { ok: false, code: 404, erreur: "Projet introuvable." };
  const statut = projet.statut as StatutProjetValeur;

  if (params.action === "ABANDONNER") {
    if (!transitionAutorisee("CLIENT", statut, "ABANDONNE")) return { ok: false, code: 409, erreur: "Ce projet ne peut plus être abandonné depuis l'espace Client : contactez l'équipe ATLAS." };
    const maj = await prisma.projet.updateMany({ where: { id: projet.id, statut }, data: { statut: "ABANDONNE" } });
    if (maj.count === 0) return { ok: false, code: 409, erreur: "Le projet a changé entre-temps, rechargez la page." };
    await prisma.evenementProjet.create({ data: { projetId: projet.id, type: "ABANDON", detail: params.message, acteurEmail: params.email, acteurRole: "CLIENT" } });
    return { ok: true };
  }

  // Les autres actions portent sur la DERNIÈRE proposition publiée.
  const proposition = await prisma.propositionProjet.findFirst({
    where: { projetId: projet.id, statut: { in: ["PUBLIEE", "ACCEPTEE", "DECLINEE"] } },
    orderBy: { version: "desc" },
  });
  if (!proposition || (params.propositionId && proposition.id !== params.propositionId)) {
    return { ok: false, code: 409, erreur: "Cette proposition n'est plus la plus récente : rechargez la page." };
  }

  if (params.action === "INTERET" || params.action === "DEMANDE_PRECISION") {
    if (params.action === "DEMANDE_PRECISION" && !params.message) return { ok: false, code: 400, erreur: "Précisez votre question ou l'ajustement souhaité." };
    if (proposition.statut !== "PUBLIEE") return { ok: false, code: 409, erreur: "Cette proposition n'est plus ouverte." };
    await prisma.evenementProjet.create({
      // REV (01/11/2026) : demande à traiter par l'équipe ATLAS (vue Admin
      // « Demandes clients »), statut visible par le Client.
      data: {
        projetId: projet.id,
        type: params.action === "INTERET" ? "INTERET_MANIFESTE" : "DEMANDE_PRECISION",
        detail: params.message,
        acteurEmail: params.email,
        acteurRole: "CLIENT",
        statutTraitement: "ENVOYEE",
      },
    });
    return { ok: true };
  }

  if (proposition.statut !== "PUBLIEE") return { ok: false, code: 409, erreur: "Cette proposition n'est plus ouverte." };

  if (params.action === "ACCEPTER") {
    // Seule une proposition VÉRIFIÉE peut être acceptée : une estimation
    // indicative n'engage ni ATLAS ni le Client.
    if (proposition.niveau !== "VERIFIEE" || statut !== "PROPOSITION_VERIFIEE") {
      return { ok: false, code: 409, erreur: "Seule une proposition vérifiée par l'équipe ATLAS peut être acceptée. Vous pouvez manifester votre intérêt pour cette proposition indicative." };
    }
    const completude = await verifierCompletudeClient(params.clientId, "CONTRACTUALISATION");
    if (!completude.ok) return { ok: false, code: 409, erreur: messageCompletude(completude.manquants), manquants: completude.manquants };
  }

  const nouveauStatutProposition = params.action === "ACCEPTER" ? "ACCEPTEE" : "DECLINEE";
  const nouveauStatutProjet: StatutProjetValeur = params.action === "ACCEPTER" ? "ACCEPTEE" : "QUALIFIE";
  const resultat = await prisma.$transaction(async (tx) => {
    const p = await tx.propositionProjet.updateMany({
      where: { id: proposition.id, statut: "PUBLIEE" },
      data: { statut: nouveauStatutProposition, decisionLe: new Date(), decisionParEmail: params.email },
    });
    const pr = await tx.projet.updateMany({ where: { id: projet.id, statut }, data: { statut: nouveauStatutProjet } });
    if (p.count === 0 || pr.count === 0) throw new Error("CONFLIT");
    await tx.evenementProjet.create({
      data: {
        projetId: projet.id,
        type: params.action === "ACCEPTER" ? "PROPOSITION_ACCEPTEE" : "PROPOSITION_DECLINEE",
        detail: `Version ${proposition.version}${params.message ? ` — ${params.message}` : ""}`,
        acteurEmail: params.email,
        acteurRole: "CLIENT",
      },
    });
    return true;
  }).catch((e: Error) => (e.message === "CONFLIT" ? false : Promise.reject(e)));
  if (!resultat) return { ok: false, code: 409, erreur: "Le projet a changé entre-temps, rechargez la page." };
  return { ok: true };
}

// ---------------------------------------------------------------- ADMIN --

export async function listerProjetsAdmin() {
  const projets = await prisma.projet.findMany({
    include: { client: { select: { nom: true } }, propositions: { select: { version: true, niveau: true, statut: true }, orderBy: { version: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  return projets.map((p) => ({
    id: p.id,
    titre: p.titre,
    type: p.type,
    statut: p.statut,
    client: p.client.nom,
    derniereProposition: p.propositions[0] ?? null,
    manquants: informationsManquantes(p).requises,
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function detailProjetAdmin(projetId: string) {
  const p = await prisma.projet.findUnique({ where: { id: projetId }, include: { ...INCLUSION_DETAIL, client: { select: { id: true, nom: true } } } });
  if (!p) return null;
  return {
    ...vueClient(p),
    // L'Admin voit aussi les brouillons et les auteurs réels.
    propositions: p.propositions.map((x) => ({ ...x, publieeLe: x.publieeLe?.toISOString() ?? null })),
    evenements: p.evenements.map((e) => ({ id: e.id, type: e.type, detail: e.detail, auteur: `${e.acteurEmail} (${e.acteurRole})`, le: e.createdAt.toISOString(), statutTraitement: e.statutTraitement })),
    client: p.client,
    needId: p.needId,
  };
}

export async function changerStatutAdmin(email: string, projetId: string, vers: StatutProjetValeur, motif: string | null): Promise<Resultat> {
  const projet = await prisma.projet.findUnique({ where: { id: projetId } });
  if (!projet) return { ok: false, code: 404, erreur: "Projet introuvable." };
  const de = projet.statut as StatutProjetValeur;
  if (!transitionAutorisee("ADMIN", de, vers)) return { ok: false, code: 409, erreur: `Transition ${de} -> ${vers} non autorisée.` };
  if (vers === "QUALIFIE") {
    const { requises } = informationsManquantes(projet);
    if (requises.length > 0) return { ok: false, code: 409, erreur: `Qualification impossible, informations manquantes : ${requises.join(", ")}.`, manquants: requises };
  }
  const maj = await prisma.projet.updateMany({ where: { id: projet.id, statut: de }, data: { statut: vers } });
  if (maj.count === 0) return { ok: false, code: 409, erreur: "Le projet a changé entre-temps, rechargez la page." };
  await prisma.evenementProjet.create({ data: { projetId: projet.id, type: `STATUT_${vers}`, detail: motif, acteurEmail: email, acteurRole: "ADMIN" } });
  return { ok: true };
}

export function lireContenuProposition(body: Record<string, unknown> | null): ContenuProposition {
  const liste = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 30) : []);
  const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const equipe = Array.isArray(body?.equipe)
    ? (body!.equipe as Record<string, unknown>[]).slice(0, 20).map((r) => ({ role: texte(r?.role, 120) ?? "", nombre: Number(r?.nombre), competences: liste(r?.competences) }))
    : [];
  const etapes = Array.isArray(body?.etapes)
    ? (body!.etapes as Record<string, unknown>[]).slice(0, 30).map((e) => ({ nom: texte(e?.nom, 200) ?? "", livrables: liste(e?.livrables), dureeEstimee: texte(e?.dureeEstimee, 100) }))
    : [];
  return {
    niveau: body?.niveau === "VERIFIEE" ? "VERIFIEE" : "INDICATIVE",
    approche: texte(body?.approche, LIMITES.long) ?? "",
    perimetre: texte(body?.perimetre, LIMITES.long) ?? "",
    equipe,
    etapes,
    delaiEstime: texte(body?.delaiEstime, 200),
    budgetEstimeMin: nombre(body?.budgetEstimeMin),
    budgetEstimeMax: nombre(body?.budgetEstimeMax),
    hypotheses: liste(body?.hypotheses),
    exclusions: liste(body?.exclusions),
  };
}

// Publie une nouvelle VERSION de proposition. La précédente version publiée
// est marquée REMPLACEE (jamais modifiée en place).
export async function publierProposition(email: string, projetId: string, contenu: ContenuProposition): Promise<Resultat<{ id: string; version: number }>> {
  const erreurs = validerProposition(contenu);
  if (erreurs.length > 0) return { ok: false, code: 400, erreur: erreurs.join(" ") };
  const projet = await prisma.projet.findUnique({ where: { id: projetId } });
  if (!projet) return { ok: false, code: 404, erreur: "Projet introuvable." };
  const de = projet.statut as StatutProjetValeur;
  if (!STATUTS_PERMETTANT_PUBLICATION.includes(de)) {
    return { ok: false, code: 409, erreur: de === "A_QUALIFIER" ? "Qualifiez d'abord le projet." : "Le projet n'accepte plus de nouvelle proposition." };
  }
  const vers = statutApresPublication(contenu.niveau);
  const resultat = await prisma.$transaction(async (tx) => {
    const derniere = await tx.propositionProjet.findFirst({ where: { projetId }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.propositionProjet.updateMany({ where: { projetId, statut: "PUBLIEE" }, data: { statut: "REMPLACEE" } });
    const maintenant = new Date();
    const cree = await tx.propositionProjet.create({
      data: {
        projetId,
        version: (derniere?.version ?? 0) + 1,
        niveau: contenu.niveau,
        statut: "PUBLIEE",
        approche: contenu.approche,
        perimetre: contenu.perimetre,
        equipe: contenu.equipe as unknown as Prisma.InputJsonValue,
        etapes: contenu.etapes as unknown as Prisma.InputJsonValue,
        delaiEstime: contenu.delaiEstime,
        budgetEstimeMin: contenu.budgetEstimeMin,
        budgetEstimeMax: contenu.budgetEstimeMax,
        hypotheses: contenu.hypotheses,
        exclusions: contenu.exclusions,
        creeParEmail: email,
        publieeLe: maintenant,
        ...(contenu.niveau === "VERIFIEE" ? { verifieeParEmail: email, verifieeLe: maintenant } : {}),
      },
      select: { id: true, version: true },
    });
    const maj = await tx.projet.updateMany({ where: { id: projetId, statut: de }, data: { statut: vers } });
    if (maj.count === 0) throw new Error("CONFLIT");
    await tx.evenementProjet.create({
      data: { projetId, type: contenu.niveau === "VERIFIEE" ? "PROPOSITION_VERIFIEE_PUBLIEE" : "PROPOSITION_INDICATIVE_PUBLIEE", detail: `Version ${cree.version}`, acteurEmail: email, acteurRole: "ADMIN" },
    });
    return cree;
  }).catch((e: Error) => (e.message === "CONFLIT" ? null : Promise.reject(e)));
  if (!resultat) return { ok: false, code: 409, erreur: "Le projet a changé entre-temps, rechargez la page." };
  return { ok: true, id: resultat.id, version: resultat.version };
}

// Rattache une mission EXISTANTE du même client à un projet engagé. La
// création de la mission reste l'outil Admin existant (/admin/missions).
export async function rattacherMission(email: string, projetId: string, missionId: string): Promise<Resultat> {
  const projet = await prisma.projet.findUnique({ where: { id: projetId } });
  if (!projet) return { ok: false, code: 404, erreur: "Projet introuvable." };
  if (projet.statut !== "ENGAGEMENT_CONFIRME" && projet.statut !== "EN_COURS") {
    return { ok: false, code: 409, erreur: "Une mission ne se rattache qu'à un projet dont l'engagement est confirmé." };
  }
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { id: true, clientId: true, projetId: true } });
  if (!mission || mission.clientId !== projet.clientId) return { ok: false, code: 404, erreur: "Mission introuvable pour ce client." };
  if (mission.projetId && mission.projetId !== projet.id) return { ok: false, code: 409, erreur: "Cette mission est déjà rattachée à un autre projet." };
  await prisma.$transaction(async (tx) => {
    await tx.mission.update({ where: { id: mission.id }, data: { projetId: projet.id } });
    if (projet.statut === "ENGAGEMENT_CONFIRME") await tx.projet.updateMany({ where: { id: projet.id, statut: "ENGAGEMENT_CONFIRME" }, data: { statut: "EN_COURS" } });
    await tx.evenementProjet.create({ data: { projetId: projet.id, type: "MISSION_RATTACHEE", detail: mission.id, acteurEmail: email, acteurRole: "ADMIN" } });
  });
  return { ok: true };
}
