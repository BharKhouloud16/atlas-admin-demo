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

type EmailParams = {
  to: string;
  subject: string;
  html: string;
};

const EMAIL_FROM = process.env.EMAIL_FROM || "Atlas Quality Partners <contact@atlas-qa.com>";

// LOT 14.1 — EMAIL PRODUCTION SAFETY HARDENING : base URL applicative pour
// les liens envoyés par email (vérification d'adresse, réinitialisation de
// mot de passe, connexion après validation de compte). Avant ce lot, ces
// trois liens étaient codés en dur vers https://atlas-admin-demo.vercel.app,
// sans jamais lire EMAIL_APP_BASE_URL — n'importe quel déploiement réel
// aurait envoyé des liens vers ce domaine de démonstration tiers dès
// RESEND_API_KEY configurée. Comportement fail-closed : si
// EMAIL_APP_BASE_URL est absente, vide, ou ne contient que des espaces,
// l'email concerné n'est PAS envoyé (jamais de repli silencieux vers le
// domaine de démo) — mais ceci ne fait jamais échouer l'action métier
// appelante (inscription, demande de réinitialisation, validation de
// compte), conformément au principe best-effort déjà en vigueur dans ce
// fichier. Un "/" final éventuel est retiré pour ne jamais produire de
// double "/" avec les chemins ci-dessous, qui commencent déjà par "/".
function resoudreBaseUrl(): string | null {
  const valeur = process.env.EMAIL_APP_BASE_URL;
  if (!valeur || valeur.trim() === "") return null;
  return valeur.trim().replace(/\/+$/, "");
}

// Retourne `true` si l'envoi a été tenté sans erreur (y compris le mode
// placeholder sans RESEND_API_KEY, cohérent avec le reste de ce fichier),
// `false` uniquement si l'appel réel au fournisseur a levé une exception.
// Valeur de retour ignorée par la totalité des appelants existants
// (fire-and-forget) — ajoutée uniquement pour lib/interview/reminders.ts
// (§12), qui doit distinguer ENVOYE d'ECHEC sur un InterviewReminder.
async function envoyerEmail({ to, subject, html }: EmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email:placeholder] À: ${to} — Sujet: ${subject}\n${html}`);
    return true;
  }
  try {
    // Import dynamique : évite de charger la dépendance côté build quand
    // aucune clé n'est configurée (démo par défaut).
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
    return true;
  } catch (e) {
    console.error(`[email:erreur] Échec d'envoi à ${to} (${subject})`, e);
    return false;
  }
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
  const base = resoudreBaseUrl();
  if (!base) {
    // Jamais le token dans ce log — seulement le fait que l'envoi est
    // abandonné et pourquoi.
    console.error("[email:configuration] EMAIL_APP_BASE_URL manquant ou vide — email de vérification d'adresse non envoyé.");
    return;
  }
  const lien = `${base}/verifier-email?token=${token}`;
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
  const base = resoudreBaseUrl();
  if (!base) {
    console.error("[email:configuration] EMAIL_APP_BASE_URL manquant ou vide — email de réinitialisation de mot de passe non envoyé.");
    return;
  }
  const lien = `${base}/reinitialiser-mot-de-passe?token=${token}`;
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

// ENGINEER ACCESS & TRUST (09/10/2026) — pendant jumeau de
// envoyerEmailCompteValide ci-dessous pour les deux autres décisions admin
// possibles (contrat §20 : "Réutiliser les mécanismes existants" — même
// fonction envoyerEmail()/même gestion best-effort, aucune nouvelle
// infrastructure de notification).
export async function envoyerEmailCompteRefuse(params: {
  to: string;
  nom: string;
  raison: string;
}) {
  const { to, nom, raison } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Votre candidature n'a pas été retenue",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Après examen de votre dossier, nous ne sommes pas en mesure de donner suite à votre candidature pour le moment.</p>
      <p><strong>Motif :</strong> ${raison}</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

export async function envoyerEmailInformationsDemandees(params: {
  to: string;
  nom: string;
  raison: string;
}) {
  const { to, nom, raison } = params;
  const base = resoudreBaseUrl();
  const lien = base ? `${base}/connexion?role=ingenieur` : null;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Informations complémentaires requises pour votre candidature",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Pour poursuivre l'examen de votre candidature, nous avons besoin d'informations complémentaires :</p>
      <p><strong>${raison}</strong></p>
      ${lien ? `<p>Connectez-vous à votre espace candidature pour les fournir : <a href="${lien}">${lien}</a></p>` : ""}
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

export async function envoyerEmailCompteValide(params: {
  to: string;
  nom: string;
  role: "INGENIEUR" | "CLIENT";
}) {
  const { to, nom, role } = params;
  const base = resoudreBaseUrl();
  if (!base) {
    console.error("[email:configuration] EMAIL_APP_BASE_URL manquant ou vide — email de compte validé non envoyé.");
    return;
  }
  const espace = role === "INGENIEUR" ? "ingénieur" : "partenaire";
  const lien = `${base}/connexion?role=${role === "INGENIEUR" ? "ingenieur" : "client"}`;
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

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §10. Même discipline que le reste de ce fichier : best-effort (jamais
// bloquant pour l'action métier appelante), lien absent si
// EMAIL_APP_BASE_URL n'est pas configurée (fail-closed, jamais de repli
// vers un domaine de démo). Confidentialité (§6/§17) : ces templates ne
// révèlent JAMAIS l'identité (nom/prénom/email) d'un autre participant —
// uniquement son rôle, jamais plus.
function formaterDateHeureEntretien(dateHeure: Date, timezoneSaisie: string): string {
  try {
    return `${new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezoneSaisie,
    }).format(dateHeure)} (${timezoneSaisie})`;
  } catch {
    return `${new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(dateHeure)} (UTC)`;
  }
}

const LIBELLES_CANAL: Record<string, string> = {
  VIDEO: "Visioconférence",
  TELEPHONE: "Téléphone",
  PRESENTIEL: "Présentiel",
  AUTRE: "À préciser",
};

// Déclenchement : InterviewParticipant créé. Destinataire : ce participant
// uniquement. Lien vers la page de réponse sans session (jeton signé,
// pattern verifier-email, voir §15).
export async function envoyerEmailInvitationEntretien(params: {
  to: string;
  token: string;
  dateHeure: Date;
  dureeMinutes: number;
  canal: string;
  lieu?: string | null;
  objectif?: string | null;
  timezoneSaisie: string;
}) {
  const { to, token, dateHeure, dureeMinutes, canal, lieu, objectif, timezoneSaisie } = params;
  const base = resoudreBaseUrl();
  if (!base) {
    console.error("[email:configuration] EMAIL_APP_BASE_URL manquant ou vide — email d'invitation à un entretien non envoyé.");
    return;
  }
  const lien = `${base}/entretiens/reponse?token=${encodeURIComponent(token)}`;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Invitation à un entretien",
    html: `
      <p>Bonjour,</p>
      <p>Vous êtes invité(e) à un entretien :</p>
      <ul>
        <li><strong>Date :</strong> ${formaterDateHeureEntretien(dateHeure, timezoneSaisie)}</li>
        <li><strong>Durée :</strong> ${dureeMinutes} minutes</li>
        <li><strong>Canal :</strong> ${LIBELLES_CANAL[canal] ?? canal}</li>
        ${lieu ? `<li><strong>Lieu :</strong> ${lieu}</li>` : ""}
        ${objectif ? `<li><strong>Objectif :</strong> ${objectif}</li>` : ""}
      </ul>
      <p><a href="${lien}">Répondre à cette invitation</a></p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Déclenchement : Interview.statut -> CONFIRME. Destinataires : tous les
// participants.
export async function envoyerEmailConfirmationEntretien(params: {
  to: string;
  dateHeure: Date;
  dureeMinutes: number;
  canal: string;
  lieu?: string | null;
  meetingUrl?: string | null;
  timezoneSaisie: string;
}) {
  const { to, dateHeure, dureeMinutes, canal, lieu, meetingUrl, timezoneSaisie } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Entretien confirmé",
    html: `
      <p>Bonjour,</p>
      <p>L'entretien est confirmé par l'ensemble des participants requis :</p>
      <ul>
        <li><strong>Date :</strong> ${formaterDateHeureEntretien(dateHeure, timezoneSaisie)}</li>
        <li><strong>Durée :</strong> ${dureeMinutes} minutes</li>
        <li><strong>Canal :</strong> ${LIBELLES_CANAL[canal] ?? canal}</li>
        ${lieu ? `<li><strong>Lieu :</strong> ${lieu}</li>` : ""}
        ${meetingUrl ? `<li><strong>Lien de connexion :</strong> <a href="${meetingUrl}">${meetingUrl}</a></li>` : ""}
      </ul>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Déclenchement : statutInvitation -> REFUSEE. Destinataire : Admin
// organisateur (notification interne), jamais les autres participants.
export async function envoyerEmailRefusEntretien(params: {
  to: string;
  participantRole: string;
  dateHeure: Date;
  timezoneSaisie: string;
  messageReponse?: string | null;
}) {
  const { to, participantRole, dateHeure, timezoneSaisie, messageReponse } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Un participant a refusé un entretien",
    html: `
      <p>Bonjour,</p>
      <p>Un participant (rôle : <strong>${participantRole}</strong>) a refusé l'entretien prévu le
      ${formaterDateHeureEntretien(dateHeure, timezoneSaisie)}.</p>
      ${messageReponse ? `<p><strong>Message :</strong> ${messageReponse}</p>` : ""}
      <p>Retrouvez le détail dans l'espace Admin.</p>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Déclenchement : rescheduling. Destinataires : tous les participants,
// nouvelle date.
export async function envoyerEmailModificationEntretien(params: {
  to: string;
  dateHeure: Date;
  dureeMinutes: number;
  canal: string;
  lieu?: string | null;
  timezoneSaisie: string;
}) {
  const { to, dateHeure, dureeMinutes, canal, lieu, timezoneSaisie } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Entretien reprogrammé",
    html: `
      <p>Bonjour,</p>
      <p>L'entretien a été reprogrammé :</p>
      <ul>
        <li><strong>Nouvelle date :</strong> ${formaterDateHeureEntretien(dateHeure, timezoneSaisie)}</li>
        <li><strong>Durée :</strong> ${dureeMinutes} minutes</li>
        <li><strong>Canal :</strong> ${LIBELLES_CANAL[canal] ?? canal}</li>
        ${lieu ? `<li><strong>Lieu :</strong> ${lieu}</li>` : ""}
      </ul>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Déclenchement : Interview.statut -> ANNULE. Destinataires : tous les
// participants.
export async function envoyerEmailAnnulationEntretien(params: {
  to: string;
  dateHeure: Date;
  timezoneSaisie: string;
  motifAnnulation?: string | null;
}) {
  const { to, dateHeure, timezoneSaisie, motifAnnulation } = params;
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Entretien annulé",
    html: `
      <p>Bonjour,</p>
      <p>L'entretien prévu le ${formaterDateHeureEntretien(dateHeure, timezoneSaisie)} a été annulé.</p>
      ${motifAnnulation ? `<p><strong>Motif :</strong> ${motifAnnulation}</p>` : ""}
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}

// Déclenchement : InterviewReminder -> ENVOYE. Destinataire : le
// participant concerné uniquement (lib/interview/reminders.ts, §12).
// Retourne le succès réel de l'envoi (voir envoyerEmail ci-dessus) : seul
// template de ce fichier dont le retour est exploité par l'appelant, pour
// distinguer InterviewReminder.statutEnvoi = ENVOYE vs ECHEC (§12).
export async function envoyerEmailRappelEntretien(params: {
  to: string;
  dateHeure: Date;
  dureeMinutes: number;
  canal: string;
  lieu?: string | null;
  meetingUrl?: string | null;
  timezoneSaisie: string;
  delaiAvantMinutes: number;
}): Promise<boolean> {
  const { to, dateHeure, dureeMinutes, canal, lieu, meetingUrl, timezoneSaisie, delaiAvantMinutes } = params;
  const delaiLibelle = delaiAvantMinutes >= 60 ? `${Math.round(delaiAvantMinutes / 60)} heure(s)` : `${delaiAvantMinutes} minutes`;
  return envoyerEmail({
    to,
    subject: `Atlas Quality Partners — Rappel : entretien dans ${delaiLibelle}`,
    html: `
      <p>Bonjour,</p>
      <p>Rappel : vous avez un entretien dans ${delaiLibelle} :</p>
      <ul>
        <li><strong>Date :</strong> ${formaterDateHeureEntretien(dateHeure, timezoneSaisie)}</li>
        <li><strong>Durée :</strong> ${dureeMinutes} minutes</li>
        <li><strong>Canal :</strong> ${LIBELLES_CANAL[canal] ?? canal}</li>
        ${lieu ? `<li><strong>Lieu :</strong> ${lieu}</li>` : ""}
        ${meetingUrl ? `<li><strong>Lien de connexion :</strong> <a href="${meetingUrl}">${meetingUrl}</a></li>` : ""}
      </ul>
      <p>À bientôt,<br/>L'équipe Atlas Quality Partners</p>
    `,
  });
}
