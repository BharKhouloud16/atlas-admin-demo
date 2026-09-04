// Secret(s) de signature des sessions JWT (voir lib/auth.ts et middleware.ts).
// Sans dépendance Node (utilisable depuis le runtime Edge de middleware.ts).
//
// Rotation : SESSION_SECRET_PREVIOUS est optionnel et permet de faire
// tourner SESSION_SECRET sans déconnecter tout le monde instantanément —
// pendant la fenêtre de rotation (au plus la durée d'une session, 8h) : on
// SIGNE toujours avec le secret courant (SESSION_SECRET), mais on accepte en
// vérification un token signé avec l'ancien (SESSION_SECRET_PREVIOUS) tant
// qu'il n'a pas expiré. Procédure de rotation recommandée sur Vercel :
// 1) copier la valeur actuelle de SESSION_SECRET dans SESSION_SECRET_PREVIOUS,
// 2) générer une nouvelle valeur pour SESSION_SECRET, 3) redéployer,
// 4) after ~8h (durée max d'une session), retirer SESSION_SECRET_PREVIOUS.
const encodeur = new TextEncoder();

export const secretCourant = encodeur.encode(process.env.SESSION_SECRET);

export const secretsVerification: Uint8Array[] = [
  secretCourant,
  ...(process.env.SESSION_SECRET_PREVIOUS ? [encodeur.encode(process.env.SESSION_SECRET_PREVIOUS)] : []),
];
