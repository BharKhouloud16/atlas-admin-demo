import { ORIGINE_PREVIEW, COMMIT_ATTENDU, enTetesBypass } from "./cible";

// globalSetup : attend que la Preview serve le commit attendu
// (Vercel reconstruit après chaque push). GET /api/sante uniquement.
export default async function attendreDeploiement() {
  if (!/^[0-9a-f]{7,40}$/.test(COMMIT_ATTENDU)) throw new Error("EXPECTED_SHA absent ou invalide.");
  const url = `${ORIGINE_PREVIEW}/api/sante`;
  const fin = Date.now() + 12 * 60 * 1000;
  let dernier = "aucune réponse";
  while (Date.now() < fin) {
    try {
      const rep = await fetch(url, { headers: enTetesBypass(url), redirect: "manual", cache: "no-store" });
      if (rep.status === 401 || rep.status === 302 || rep.status === 307) {
        throw new Error(`Protection Vercel active (HTTP ${rep.status}) : secret refusé ou absent — BLOCKED.`);
      }
      const corps = (await rep.json().catch(() => null)) as { commit?: string } | null;
      dernier = `HTTP ${rep.status}, commit servi=${corps?.commit ?? "?"}`;
      if (corps?.commit && COMMIT_ATTENDU.startsWith(corps.commit.toLowerCase())) {
        console.log(`Preview prête : ${dernier}`);
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("BLOCKED")) throw e;
      dernier = "erreur réseau";
    }
    await new Promise((ok) => setTimeout(ok, 20_000));
  }
  throw new Error(`La Preview ne sert pas ${COMMIT_ATTENDU.slice(0, 7)} après 12 min (${dernier}).`);
}
