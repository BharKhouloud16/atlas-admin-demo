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

async function envoyerEmail({ to, subject, html }: EmailParams) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email:placeholder] À: ${to} — Sujet: ${subject}\n${html}`);
    return;
  }
  try {
    // Import dynamique : évite de charger la dépendance côté build quand
    // aucune clé n'est configurée (démo par défaut).
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
  } catch (e) {
    console.error(`[email:erreur] Échec d'envoi à ${to} (${subject})`, e);
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
  const lien = `https://atlas-admin-demo.vercel.app/verifier-email?token=${token}`;
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

export async function envoyerEmailCompteValide(params: {
  to: string;
  nom: string;
  role: "INGENIEUR" | "CLIENT";
}) {
  const { to, nom, role } = params;
  const espace = role === "INGENIEUR" ? "ingénieur" : "partenaire";
  await envoyerEmail({
    to,
    subject: "Atlas Quality Partners — Votre compte est activé",
    html: `
      <p>Bonjour ${nom},</p>
      <p>Votre compte ${espace} a été validé. Vous pouvez dès à présent vous connecter :</p>
      <p><a href="https://atlas-admin-demo.vercel.app/connexion?role=${role === "INGENIEUR" ? "ingenieur" : "client"}">Se connecter</a></p>
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
