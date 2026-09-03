// Envoi d'emails transactionnels — inscription en attente / compte validé.
//
// ⚠️ Aucun fournisseur d'email n'est branché pour l'instant (pas de clé API
// Resend / SendGrid / SMTP fournie pour ce projet). En attendant, chaque
// appel se contente de logger le contenu de l'email dans les journaux
// Vercel, pour qu'on puisse vérifier le contenu/déclenchement sans bloquer
// le reste de la démo.
//
// Pour activer l'envoi réel plus tard (ex. avec Resend) :
//   1. npm i resend
//   2. Ajouter RESEND_API_KEY dans les variables d'environnement Vercel
//   3. Remplacer le corps de `envoyerEmail` ci-dessous par un appel réel :
//        const resend = new Resend(process.env.RESEND_API_KEY);
//        await resend.emails.send({ from: "Atlas Quality Partners <contact@atlas-qa.com>", to, subject, html });

type EmailParams = {
  to: string;
  subject: string;
  html: string;
};

async function envoyerEmail({ to, subject, html }: EmailParams) {
  // TODO: brancher un vrai fournisseur d'email (voir commentaire en haut du fichier).
  console.log(`[email:placeholder] À: ${to} — Sujet: ${subject}\n${html}`);
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
