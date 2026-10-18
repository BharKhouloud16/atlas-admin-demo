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

// LOT 12.1 — SECURITY HARDENING : sans cette garde, un SESSION_SECRET
// absent/vide/whitespace ne provoquait aucune erreur (TextEncoder.encode
// retombe silencieusement sur une clé de longueur zéro), et l'application
// signait/vérifiait quand même des sessions avec une clé HMAC vide — un
// secret de fait absent, jamais un échec explicite. On refuse maintenant de
// charger ce module plutôt que de tourner en mode non sécurisé. Ne jamais
// journaliser la valeur elle-même, seulement le nom de la variable en cause.
export function exigerSecret(valeur: string | undefined, nomVariable: string): string {
  if (!valeur || valeur.trim() === "") {
    throw new Error(
      `Configuration invalide : la variable d'environnement ${nomVariable} doit être définie avec une valeur non vide.`
    );
  }
  return valeur;
}

export const secretCourant = encodeur.encode(exigerSecret(process.env.SESSION_SECRET, "SESSION_SECRET"));

// SESSION_SECRET_PREVIOUS reste optionnel (rotation) — sa présence ne
// dispense jamais SESSION_SECRET d'être défini ci-dessus : le secret
// courant reste obligatoire dans tous les cas.
export const secretsVerification: Uint8Array[] = [
  secretCourant,
  ...(process.env.SESSION_SECRET_PREVIOUS ? [encodeur.encode(process.env.SESSION_SECRET_PREVIOUS)] : []),
];
