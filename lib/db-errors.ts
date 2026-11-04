// V1 — détection des erreurs d'indisponibilité de la base (sans dépendance :
// testable sans base ni Next.js, voir tests/unit/api-errors.spec.ts).
// La détection se fait sur `name` / `code` plutôt que par `instanceof` :
// les classes Prisma peuvent être dupliquées entre bundles (edge/node).

// Codes Prisma signifiant que la base est inaccessible ou saturée — à
// distinguer d'une erreur de requête (contrainte, donnée invalide…).
const CODES_INDISPONIBILITE = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server timed out
  "P1003", // Database does not exist
  "P1008", // Operations timed out
  "P1010", // Access denied
  "P1011", // TLS error
  "P1017", // Server has closed the connection
  "P2024", // Timed out fetching a new connection from the pool
]);

const NOMS_INDISPONIBILITE = new Set(["PrismaClientInitializationError", "PrismaClientRustPanicError"]);

type ErreurInspectable = { name?: unknown; code?: unknown; errorCode?: unknown };

export function estIndisponibiliteBase(erreur: unknown): boolean {
  if (!erreur || typeof erreur !== "object") return false;
  const e = erreur as ErreurInspectable;
  if (typeof e.name === "string" && NOMS_INDISPONIBILITE.has(e.name)) return true;
  const code = typeof e.code === "string" ? e.code : typeof e.errorCode === "string" ? e.errorCode : undefined;
  return code !== undefined && CODES_INDISPONIBILITE.has(code);
}

// Résumé journalisable : uniquement le type et le code de l'erreur. Le
// message Prisma n'est volontairement PAS journalisé : il peut contenir
// l'hôte, l'utilisateur de connexion ou des fragments de requête.
export function resumeErreurJournalisable(erreur: unknown): string {
  if (!erreur || typeof erreur !== "object") return typeof erreur;
  const e = erreur as ErreurInspectable;
  const nom = typeof e.name === "string" ? e.name : "Error";
  const code = typeof e.code === "string" ? e.code : typeof e.errorCode === "string" ? e.errorCode : undefined;
  return code ? `${nom}(${code})` : nom;
}

