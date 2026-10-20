// Vérification de la Preview Vercel en LECTURE SEULE, depuis GitHub Actions
// (l'environnement de développement n'a pas d'accès réseau à *.vercel.app).
// Uniquement des requêtes GET anonymes : aucune connexion, aucun secret,
// aucune route qui écrit en base (pas de /api/dev-seed, pas d'API dont le
// refus journalise un événement — les API testées sont refusées par le
// middleware avant tout accès à la base).
// La Production n'est interrogée que sur GET /api/sante (lecture seule,
// SELECT 1), pour comparer l'empreinte de base.
const PREVIEWS = (process.env.PREVIEWS || "").split(",").map((x) => x.trim()).filter(Boolean);
const PRODUCTION = "https://atlas-admin-demo.vercel.app";
const HOTE_PREVIEW = /^atlas-admin-demo-git-[a-z0-9-]+-bharkhouloud16\.vercel\.app$/;
const ATTENTE_MAX_MS = 12 * 60 * 1000;

const lignes = [];
const r = (cible, controle, verdict, detail) => {
  lignes.push({ cible, controle, verdict, detail });
  console.log(`${verdict.padEnd(14)} ${cible} — ${controle} — ${detail}`);
};

async function get(url, options = {}) {
  const u = new URL(url);
  if (u.origin !== PRODUCTION && !HOTE_PREVIEW.test(u.hostname)) throw new Error(`hôte non autorisé : ${u.hostname}`);
  if (u.origin === PRODUCTION && u.pathname !== "/api/sante") throw new Error("Production : seul GET /api/sante est autorisé");
  return fetch(url, { method: "GET", redirect: "manual", cache: "no-store", ...options });
}

function protectionVercel(rep, texte) {
  return rep.status === 401 || (rep.status === 403 && /vercel/i.test(texte)) || /vercel authentication|_vercel_sso/i.test(texte);
}

async function sante(origine) {
  const rep = await get(`${origine}/api/sante`);
  const texte = await rep.text();
  let corps = null;
  try { corps = JSON.parse(texte); } catch {}
  return { rep, texte, corps };
}

async function verifierPreview(spec) {
  const [hote, shaAttendu] = spec.split("@");
  const origine = `https://${hote}`;
  if (!HOTE_PREVIEW.test(hote)) { r(hote, "cible", "FAIL", "hôte refusé"); return null; }

  // Attente du déploiement du commit attendu (Vercel reconstruit après chaque push).
  const debut = Date.now();
  let s;
  for (;;) {
    s = await sante(origine).catch((e) => ({ erreur: e.message }));
    if (s.erreur) { r(hote, "accès", "BLOCKED", s.erreur); return null; }
    if (protectionVercel(s.rep, s.texte)) { r(hote, "accès", "BLOCKED", `protection Vercel active (HTTP ${s.rep.status}) : non contournée`); return null; }
    if (s.corps?.commit && shaAttendu.startsWith(s.corps.commit)) break;
    if (Date.now() - debut > ATTENTE_MAX_MS) break;
    await new Promise((ok) => setTimeout(ok, 20000));
  }
  const c = s.corps || {};
  r(hote, "GET /api/sante", s.rep.status === 200 && c.base === "ok" ? "PASS" : "FAIL", `HTTP ${s.rep.status}, base=${c.base}, statut=${c.statut}, latence=${c.latenceMs} ms`);
  r(hote, "environnement", c.environnement === "preview" ? "PASS" : "FAIL", `VERCEL_ENV=${c.environnement}`);
  r(hote, "commit servi", c.commit && shaAttendu.startsWith(c.commit) ? "PASS" : "FAIL", `servi=${c.commit} attendu=${shaAttendu.slice(0, 7)}`);
  r(hote, "base ciblée", c.cible?.libelle === "supabase-atlas-preview" ? "PASS" : "FAIL", `type=${c.cible?.type} empreinte=${c.cible?.empreinte} libellé=${c.cible?.libelle}`);

  const ko = [];
  for (const p of ["/", "/connexion", "/inscription", "/mot-de-passe-oublie", "/confidentialite"]) {
    const rep = await get(origine + p);
    if (rep.status !== 200) ko.push(`${p}=${rep.status}`);
  }
  r(hote, "pages publiques (200)", ko.length ? "FAIL" : "PASS", ko.join(", ") || "5/5");

  const prot = [];
  for (const p of ["/admin", "/admin/securite-intelligence", "/admin/recherche", "/client", "/ingenieur", "/ingenieur/compte-desactive"]) {
    const rep = await get(origine + p);
    const loc = rep.headers.get("location") || "";
    prot.push({ p, ok: [307, 308].includes(rep.status) && new URL(loc, origine).pathname === "/connexion", d: `${p}→${rep.status} ${loc ? new URL(loc, origine).pathname : ""}` });
  }
  r(hote, "pages protégées → /connexion (anonyme)", prot.every((x) => x.ok) ? "PASS" : "FAIL", prot.map((x) => x.d).join(" ; "));

  const api = [];
  for (const p of ["/api/clients", "/api/comptes", "/api/profils", "/api/ingenieurs"]) {
    const rep = await get(origine + p);
    api.push({ p, ok: rep.status === 403, d: `${p}→${rep.status}` });
  }
  r(hote, "API protégées → 403 (anonyme, middleware)", api.every((x) => x.ok) ? "PASS" : "FAIL", api.map((x) => x.d).join(" ; "));
  return c.cible || null;
}

(async () => {
  const cibles = [];
  for (const spec of PREVIEWS) cibles.push(await verifierPreview(spec));

  // Isolation : l'empreinte de la base Production n'est lisible que si /api/sante existe sur la Production.
  const prod = await sante(PRODUCTION).catch((e) => ({ erreur: e.message }));
  if (prod.erreur) {
    r("Production", "GET /api/sante", "BLOCKED", prod.erreur);
  } else if (protectionVercel(prod.rep, prod.texte)) {
    r("Production", "GET /api/sante", "BLOCKED", `protection Vercel (HTTP ${prod.rep.status})`);
  } else if (!prod.corps?.cible) {
    r("Production", "empreinte de base", "NON CONFIRMÉE", `HTTP ${prod.rep.status} : /api/sante absent de la Production (main) — empreinte illisible en lecture seule`);
  } else {
    const p = prod.corps.cible;
    const differentes = cibles.filter(Boolean).every((c) => c.empreinte && p.empreinte && c.empreinte !== p.empreinte);
    r("Production", "empreinte de base", differentes ? "PASS" : "FAIL", `Production : ${p.libelle ?? p.empreinte} ; Preview : ${cibles.filter(Boolean).map((c) => c.libelle ?? c.empreinte).join(", ")}`);
  }

  const echecs = lignes.filter((l) => l.verdict === "FAIL").length;
  const fs = await import("fs");
  const tableau = ["| Cible | Contrôle | Verdict | Détail |", "|---|---|---|---|", ...lignes.map((l) => `| ${l.cible} | ${l.controle} | ${l.verdict} | ${String(l.detail).replace(/\|/g, "/")} |`)].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Preview — vérification en lecture seule\n\n${tableau}\n`);
  fs.writeFileSync("resultats-preview.json", JSON.stringify({ date: new Date().toISOString(), lignes }, null, 2));
  console.log(`\nRÉSUMÉ ${JSON.stringify({ PASS: lignes.filter((l) => l.verdict === "PASS").length, FAIL: echecs, autres: lignes.filter((l) => !["PASS", "FAIL"].includes(l.verdict)).length })}`);
  process.exit(echecs ? 1 : 0);
})();
