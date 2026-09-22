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

// PHASE 14 — Production Readiness (22/09/2026) : si SESSION_SECRET est
// absent, TextEncoder.encode(undefined) produit une clé de 0 octet — jose
// signe et vérifie alors des JWT HS256 avec une clé vide sans lever
// d'erreur (vérifié empiriquement), ce qui permettrait de forger un cookie
// de session pour n'importe quel rôle (y compris ADMIN) sans connaître
// aucun secret. Échouer immédiatement au chargement du module (Edge et
// Node) plutôt que de dégrader silencieusement vers une clé forgeable.
// 32 caractères = la longueur d'un secret généré par `openssl rand -base64
// 32` (recommandé par .env.example), pas une valeur arbitraire.
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error(
    "SESSION_SECRET manquant ou trop court (minimum 32 caractères, voir .env.example : openssl rand -base64 32) — refus de démarrer avec une clé de session non sûre."
  );
}

export const secretCourant = encodeur.encode(secret);

export const secretsVerification: Uint8Array[] = [
  secretCourant,
  ...(process.env.SESSION_SECRET_PREVIOUS ? [encodeur.encode(process.env.SESSION_SECRET_PREVIOUS)] : []),
];
