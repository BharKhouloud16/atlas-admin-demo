// Envoi d'emails transactionnels — inscription en attente / compte validé /
// CRA rejeté / nouvelle évaluation reçue.
//
// Envoi réel via Resend dès que RESEND_API_KEY est présente dans les
// variables d'environnement Vercel — sinon (comme pour toute démo sans
// fournisseur configuré) chaque appel se contente de logger le contenu de
// l'email dans les journaux Vercel, pour qu'on puisse vérifier le
// contenu/déclenchement sans bloquer le reste de la démo. Best-effort dans
// les deux cas : un échec d'envoi ne doit jamais faire échouer l'action
// métier associée (validation de compte, rejet de CRA...).
//
// Pour activer l'envoi réel : ajouter RESEND_API_KEY dans les variables
// d'environnement Vercel (Project Settings -> Environment Variables), et
// éventuellement EMAIL_FROM si l'adresse par défaut ci-dessous n'est pas
// vérifiée sur le domaine Resend utilisé.

import { createHash } from "crypto";

type EmailParams = {
  to: string;
  subject: string;
  html: string;
};

const EMAIL_FROM = process.env.EMAIL_FROM || "Atlas Quality Partners <contact@atlas-qa.com>";

// SÉCURITÉ — journalisation : avant ce correctif, le mode « placeholder »
// (sans RESEND_API_KEY, cas actuel de Preview et Production) écrivait le
// contenu HTML complet de chaque email dans les journaux serveur, y compris
// les liens de vérification d'email et de réinitialisation de mot de passe
// avec leur jeton : toute personne ayant accès aux journaux Vercel pouvait
// prendre le contrôle d'un compte. Désormais, seuls le destinataire masqué et
// le sujet sont journalisés — jamais le contenu, jamais un lien.
export function masquerEmail(adresse: string): string {
  const [local, domaine] = adresse.split("@");
  if (!domaine) return "***";
  return `${local.slice(0, 1)}***@${domaine}`;
}

// Empreinte courte et non réversible du destinataire : permet de corréler
// les journaux (et aux tests de vérifier un envoi précis) sans écrire
// l'adresse complète.
export function empreinteEmail(adresse: string): string {
  return createHash("sha256").update(adresse.trim().toLowerCase()).digest("hex").slice(0, 12);
}

// URL de base des liens envoyés par email, propre à chaque environnement.
// Avant ce correctif, les liens pointaient en dur vers le domaine de
// Production, y compris depuis la Preview (jeton Preview inutilisable en
// Production). Ordre de résolution :
//   1. EMAIL_APP_BASE_URL si définie (même variable que la PR #55 et que
//      lib/message-attention-email.ts) ;
//   2. sur Vercel, les variables système : Production -> domaine de
//      production du projet ; Preview -> URL de la branche (ou du déploiement) ;
//   3. sinon : aucune URL -> l'email contenant un lien n'est PAS envoyé
//      (fail-closed, jamais de repli vers un autre environnement). L'action
//      métier appelante n'échoue jamais pour autant (best-effort).
export function resoudreBaseUrlApplication(env: Record<string, string | undefined> = process.env): string | null {
  const brute =
    env.EMAIL_APP_BASE_URL?.trim() ||
    (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (env.VERCEL_ENV === "preview" && (env.VERCEL_BRANCH_URL || env.VERCEL_URL) ? `https://${env.VERCEL_BRANCH_URL || env.VERCEL_URL}` : "");
  if (!brute) return null;
  try {
    const url = new URL(brute);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// L'envoi réel d'emails est-il possible ? Fournisseur configuré
// (RESEND_API_KEY non vide) ET URL de base des liens résolue pour cet
// environnement. Sans cela, aucun email n'est réellement envoyé : le mode
// « placeholder » ne fait que journaliser (sans contenu).
export function envoiEmailsOperationnel(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim()) && resoudreBaseUrlApplication(env) !== null;
}

// Sur un déploiement Vercel (Preview ou Production), les parcours qui
// reposent sur un email (inscription, renvoi de vérification, mot de passe
// oublié) répondent 503 tant que l'envoi n'est pas opérationnel, AVANT toute
// lecture en base : la réponse est donc identique pour toute adresse (aucune
// énumération) et le système ne prétend jamais avoir envoyé un email qui ne
// part pas. Hors Vercel (CI, poste local), le mode placeholder reste le
// comportement de développement.
export function parcoursEmailIndisponible(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL_ENV) && !envoiEmailsOperationnel(env);
}

export const MESSAGE_EMAIL_INDISPONIBLE =
  "L'envoi d'emails est momentanément indisponible : cette opération ne peut pas aboutir pour le moment. Réessayez plus tard ou contactez l'administrateur.";

// Client d'envoi : forme minimale de l'instance Resend utilisée ici
// (resend.emails.send). Permet aux tests de fournir un client simulé, sans
// réseau ni email réel.
export type ClientEnvoiEmail = {
  emails: { send(params: { from: string; to: string; subject: string; html: string }): Promise<unknown> };
};

// Code d'erreur journalisable : uniquement un identifiant court (ex.
// « validation_error », « TypeError »). Tout le reste — en particulier le
// champ `message` du fournisseur, qui peut contenir une adresse ou un domaine —
// n'est jamais journalisé.
function codeErreurAssaini(valeur: unknown): string {
  return typeof valeur === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(valeur) ? valeur : "inconnue";
}

function journaliserEchec(to: string, code: string, statut?: unknown) {
  const statutAssaini = typeof statut === "number" && Number.isInteger(statut) && statut >= 100 && statut <= 599 ? ` (HTTP ${statut})` : "";
  console.error(`[email:erreur] Échec d'envoi à ${masquerEmail(to)} [${empreinteEmail(to)}] : ${code}${statutAssaini}`);
}

// D6 — Resend v4 ne lève pas d'exception sur une erreur d'API : `emails.send`
// renvoie { data: { id }, error: null } en cas de succès et
// { data: null, error: { name, message } } en cas d'échec (clé invalide,
// domaine non vérifié, quota…). Avant ce correctif, ce résultat était ignoré :
// tout échec d'API passait pour un succès, sans aucune trace. Désormais, un
// envoi n'est un succès que si `error` est vide ET qu'un identifiant
// d'email est renvoyé.
export async function envoyerAvecClient(client: ClientEnvoiEmail, { to, subject, html }: EmailParams): Promise<boolean> {
  try {
    const resultat = (await client.emails.send({ from: EMAIL_FROM, to, subject, html })) as
      | { data?: { id?: unknown } | null; error?: { name?: unknown; statusCode?: unknown } | null }
      | null
      | undefined;
    const erreur = resultat?.error;
    if (erreur) {
      journaliserEchec(to, codeErreurAssaini(erreur.name), erreur.statusCode);
      return false;
    }
    const id = resultat?.data?.id;
    if (typeof id !== "string" || !id) {
      journaliserEchec(to, "reponse_inattendue");
      return false;
    }
    return true;
  } catch (e) {
    // Comportement conservé : une exception (réseau, construction du client…)
    // est un échec, journalisé sans son message.
    journaliserEchec(to, codeErreurAssaini((e as { name?: unknown } | null)?.name ?? "Error"));
    return false;
  }
}

// Retourne true si l'email a été envoyé (ou, sans fournisseur configuré, en
// mode placeholder : rien n'est envoyé, seul un journal sans contenu est
// écrit), false en cas d'échec du fournisseur (erreur renvoyée ou exception).
async function envoyerEmail(params: EmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[email:placeholder] NON ENVOYÉ (aucun fournisseur configuré) — À: ${masquerEmail(params.to)} [${empreinteEmail(params.to)}] — Sujet: ${params.subject} (contenu non journalisé)`
    );
    return true;
  }
  let client: ClientEnvoiEmail;
  try {
    // Import dynamique : évite de charger la dépendance côté build quand
    // aucune clé n'est configurée (démo par défaut).
    const { Resend } = await import("resend");
    client = new Resend(apiKey);
  } catch (e) {
    journaliserEchec(params.to, codeErreurAssaini((e as { name?: unknown } | null)?.name ?? "Error"));
    return false;
  }
  return envoyerAvecClient(client, params);
}

// Construit un lien absolu vers un chemin de l'application, ou null si l'URL
// de base de l'environnement est inconnue (email alors non envoyé).
function lienApplication(chemin: string): string | null {
  const base = resoudreBaseUrlApplication();
  if (!base) {
    console.error("[email:non-envoye] URL de base de l'application inconnue (EMAIL_APP_BASE_URL / VERCEL_*) : email contenant un lien non envoyé.");
    return null;
  }
  return `${base}${chemin}`;
}

export async function envoyerEmailInscriptionEnAttente(params: {
  to: string;
  nom: string;
  role: "INGENIEUR" | "CLIENT";
}) {
  const { to, nom, role } = params;
  const espace = role === "INGENIEUR" ? "ingénieur" : "partenaire";
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Votre compte est en attente de validation",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Votre demande de création de compte ${espace} a bien été reçue.</p>
      <p>Notre équipe va valider votre dossier sous peu — vous recevrez un email dès que votre accès sera activé.</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Email de vérification d'adresse envoyé juste après l'inscription (voir
// app/api/auth/signup/route.ts) : tant que le lien n'est pas cliqué,
// l'ingénieur/client ne peut pas se connecter (voir app/api/auth/login/route.ts).
// ⚠️ Comme le reste de ce fichier, aucun fournisseur d'email n'étant branché,
// le lien n'est PAS réellement envoyé pour l'instant : il est seulement
// loggé ici, et renvoyé directement dans la réponse de /api/auth/signup pour
// permettre de tester le parcours en attendant qu'un vrai fournisseur
// (Resend...) soit configuré.
export async function envoyerEmailVerificationAdresse(params: {
  to: string;
  nom: string;
  token: string;
}) {
  const { to, nom, token } = params;
  const lien = lienApplication(`/verifier-email?token=${token}`);
  if (!lien) return;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Confirmez votre adresse email",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Merci de confirmer votre adresse email pour finaliser votre inscription :</p>
      <p><a href="${lien}">${lien}</a></p>
      <p>Ce lien est valable 24 heures.</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// B14 — mot de passe oublié (voir app/api/auth/mot-de-passe-oublie/route.ts).
// Même limitation démo que ci-dessus (aucun fournisseur d'email branché) :
// le lien n'est pas réellement envoyé, seulement loggé/renvoyé à l'appelant.
export async function envoyerEmailReinitialisationMotDePasse(params: {
  to: string;
  token: string;
}) {
  const { to, token } = params;
  const lien = lienApplication(`/reinitialiser-mot-de-passe?token=${token}`);
  if (!lien) return;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Réinitialisation de votre mot de passe",
    html: `
      <p>Bonjour,</p>
      <p>Une demande de réinitialisation de mot de passe a été faite pour ce compte :</p>
      <p><a href="${lien}">${lien}</a></p>
      <p>Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// SÉCURITÉ — anti-énumération à l'inscription : quand une inscription est
// tentée avec une adresse déjà utilisée, l'API répond exactement comme pour
// une nouvelle inscription, et c'est le titulaire de l'adresse qui est
// prévenu par email (aucun jeton dans cet email).
export async function envoyerEmailTentativeInscriptionExistante(params: { to: string }) {
  const lienConnexion = lienApplication("/connexion");
  const lienOubli = lienApplication("/mot-de-passe-oublie");
  if (!lienConnexion || !lienOubli) return;
  await envoyerEmail({
    to: params.to,
    subject: "Atlas Quality Partners — Tentative d'inscription avec votre adresse",
    html: `
      <p>Bonjour,</p>
      <p>Une demande de création de compte vient d'être faite avec votre adresse email, déjà associée à un compte Atlas Quality Partners.</p>
      <p>Si c'est vous, connectez-vous : <a href="${lienConnexion}">${lienConnexion}</a><br/>
      Mot de passe oublié : <a href="${lienOubli}">${lienOubli}</a></p>
      <p>Si ce n'est pas vous, vous pouvez ignorer cet email : aucun nouveau compte n'a été créé.</p>
      <p>L'équipe Atlas Quality Partners</p>
    `,
  });
}

export async function envoyerEmailCompteValide(params: {
  to: string;
  nom: string;
  role: "INGENIEUR" | "CLIENT";
}) {
  const { to, nom, role } = params;
  const espace = role === "INGENIEUR" ? "ingénieur" : "partenaire";
  const lien = lienApplication(`/connexion?role=${role === "INGENIEUR" ? "ingenieur" : "client"}`);
  if (!lien) return;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Votre compte est activé",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Votre compte ${espace} a été validé. Vous pouvez dès à présent vous connecter :</p>
      <p><a href="${lien}">Se connecter</a></p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}


    // Notification interne a l'equipe Atlas (contact@atlas-qa.com) lorsqu'un
// prospect reserve un appel ou envoie un message via le formulaire de
// contact public -- voir app/api/demandes-contact/route.ts. Aucune action
// requise du prospect : la demande est de toute facon consultable
// immediatement dans /admin/demandes.
export async function envoyerEmailNouvelleDemandeContact(params: {
  to: string;
  nom: string;
  email: string;
  entreprise: string | null;
  telephone: string | null;
  message: string | null;
  creneauSouhaite: string | null;
}) {
  const { to, nom, email, entreprise, telephone, message, creneauSouhaite } = params;
  await envoyerEmail({
    to,
    subject: `Nouvelle demande de contact -- ${nom}`,
    html: `
    <p>Nouvelle demande recue depuis le site (reservation d'appel / formulaire de contact) :</p>
    <ul>
    <li><strong>Nom :</strong> ${nom}</li>
    <li><strong>Email :</strong> ${email}</li>
    <li><strong>Entreprise :</strong> ${entreprise ?? "-"}</li>
    <li><strong>Telephone :</strong> ${telephone ?? "-"}</li>
    <li><strong>Creneau souhaite :</strong> ${creneauSouhaite ?? "-"}</li>
    <li><strong>Message :</strong> ${message ?? "-"}</li>
    </ul>
    <p>A traiter depuis /admin/demandes.</p>
    `,
  });
}

// Notifie l'ingénieur quand l'Admin rejette sa feuille de temps (voir
// app/api/feuilles-de-temps/route.ts, action "rejeter") — jusqu'ici il
// fallait revenir se connecter pour s'en apercevoir.
export async function envoyerEmailCraRejete(params: {
  to: string;
  nom: string;
  mois: string;
  motif: string;
}) {
  const { to, nom, mois, motif } = params;
  await envoyerEmail({
    to,
    subject: `Atlas Quality Partners — Votre feuille de temps de ${mois} a été rejetée`,
    html: `
      <p>Bonjour ${nom},</p>
      <p>Votre feuille de temps de <strong>${mois}</strong> a été rejetée par l'administrateur.</p>
      <p><strong>Motif :</strong> ${motif}</p>
      <p>Merci de la corriger et de la soumettre à nouveau depuis votre espace ingénieur.</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// V2.5 — Communication Intelligence (Lot 4, 21/09/2026). Déclenché depuis
// lib/message-attention-email.ts uniquement lors d'une transition RÉELLE
// vers "non lu" (jamais à chaque message — voir ce fichier pour la
// déduplication), et seulement si PreferenceNotification l'autorise. Un
// seul nouveau modèle d'email ajouté ici, aucune nouvelle infrastructure.
export async function envoyerEmailMessageNonLu(params: { to: string; nom?: string; lien: string }) {
  const { to, nom, lien } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Nouveaux messages non lus",
    html: `
      <p>Bonjour${nom ? ` ${nom}` : ""},</p>
      <p>Vous avez de nouveaux messages non lus sur votre espace Atlas Quality Partners.</p>
      <p><a href="${lien}">Voir la conversation</a></p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Notifie l'ingénieur dès qu'un client dépose une évaluation sur une de ses
// missions terminées (voir app/api/evaluations/route.ts, POST).
export async function envoyerEmailNouvelleEvaluation(params: {
  to: string;
  nom: string;
  mission: string;
  note: number;
}) {
  const { to, nom, mission, note } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Vous avez reçu une nouvelle évaluation",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Vous avez reçu une nouvelle évaluation client sur la mission <strong>${mission}</strong> : ${note}/5.</p>
      <p>Retrouvez le détail dans votre espace ingénieur, onglet Historique de mission avec Atlas.</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}
