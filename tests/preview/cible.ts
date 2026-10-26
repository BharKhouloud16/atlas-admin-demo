// Cible des tests E2E DISTANTS sur une Preview Vercel (tests/preview).
//
// Règles de sécurité (non négociables) :
// - seul un alias de branche Preview du projet est accepté
//   (atlas-admin-demo-git-<branche>-bharkhouloud16.vercel.app) ;
// - l'alias de la branche main (« git-main- ») est REFUSÉ : c'est un
//   domaine de la Production ;
// - le domaine de Production, localhost et tout domaine externe sont refusés ;
// - le secret Vercel « Protection Bypass for Automation » n'est envoyé
//   QU'À l'hôte validé ci-dessous, jamais ailleurs ;
// - il n'est jamais écrit dans un log, une trace, une capture ou un artefact.
export const HOTE_PREVIEW_AUTORISE =
  /^atlas-admin-demo-git-(?!main-)[a-z0-9-]+-bharkhouloud16\.vercel\.app$/;

function lireCible(): { hote: string; origine: string } {
  const brute = process.env.PREVIEW_URL ?? "";
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    throw new Error("PREVIEW_URL absente ou invalide : tests distants refusés.");
  }
  if (url.protocol !== "https:" || !HOTE_PREVIEW_AUTORISE.test(url.hostname) || url.port !== "") {
    // Le nom d'hôte n'est pas un secret : il peut figurer dans l'erreur.
    throw new Error(`Hôte refusé pour les tests distants : ${url.hostname}`);
  }
  return { hote: url.hostname, origine: url.origin };
}

export const { hote: HOTE_PREVIEW, origine: ORIGINE_PREVIEW } = lireCible();

const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
if (!SECRET) {
  // Sans secret, la protection Vercel reste active : on échoue explicitement
  // plutôt que de rapporter des tests « verts » qui n'ont rien vérifié.
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET absent : tests distants bloqués (BLOCKED).");
}

export function estHoteAutorise(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === HOTE_PREVIEW && u.port === "";
  } catch {
    return false;
  }
}

// En-têtes officiels Vercel. À n'utiliser que pour une URL validée par
// estHoteAutorise() : la fonction refuse toute autre destination.
// - API / attente du déploiement : en-tête seul, sans redirection suivie.
// - Navigateur (cookie: true) : « x-vercel-set-bypass-cookie » fait poser par
//   Vercel un cookie limité à l'hôte Preview (réponse 307 vers la même URL).
//   Les redirections suivantes s'appuient sur ce cookie, que le navigateur
//   n'envoie qu'à cet hôte : l'en-tête secret n'est jamais rejoué ailleurs
//   (voir fixtures.ts).
export function enTetesBypass(url: string, options: { cookie?: boolean } = {}): Record<string, string> {
  if (!estHoteAutorise(url)) throw new Error("Destination non autorisée pour le secret de contournement.");
  return {
    "x-vercel-protection-bypass": SECRET,
    ...(options.cookie ? { "x-vercel-set-bypass-cookie": "true" } : {}),
  };
}

export const COMMIT_ATTENDU = (process.env.EXPECTED_SHA ?? "").toLowerCase();
