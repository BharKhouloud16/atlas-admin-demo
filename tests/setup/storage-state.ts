import path from "path";

// Chemins des sessions pré-authentifiées produites par auth.setup.ts et
// consommées via test.use({ storageState: ... }) par les fichiers qui n'ont
// besoin d'un rôle que comme précondition (pas comme sujet du test lui-même
// — voir tests/setup/auth.setup.ts pour la règle complète). Constantes
// partagées pour éviter toute divergence de chemin entre le setup et ses
// consommateurs.
const RACINE_AUTH = path.join(__dirname, "..", "..", ".auth");

export const ADMIN_STATE = path.join(RACINE_AUTH, "admin.json");
export const CLIENT_STATE = path.join(RACINE_AUTH, "client.json");
export const INGENIEUR_STATE = path.join(RACINE_AUTH, "ingenieur.json");
