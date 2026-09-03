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
