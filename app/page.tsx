import Link from "next/link";

// Page d'accueil v1.2 — reprend la structure du site vitrine atlas-qa.com,
// avec 3 points d'entrée vers la démo à la place du bouton "Réserver un appel" :
// Espace Ingénieur / Espace Partenaire / Connexion. Chacun renvoie vers la même
// page de connexion (mécanisme d'auth unique), avec un paramètre ?role= qui
// pré-sélectionne le contexte affiché.

const bleu = "#2557d6";
const bleuFonce = "#12224a";
const grisTexte = "#4b5567";
const bordure = "#e4e7ee";

function Bouton({
  href,
  children,
  variante = "pleine",
}: {
  href: string;
  children: React.ReactNode;
  variante?: "pleine" | "contour" | "texte";
}) {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  const styles: Record<string, React.CSSProperties> = {
    pleine: { ...base, background: bleu, color: "#fff" },
    contour: { ...base, background: "#fff", color: bleu, border: `1px solid ${bleu}` },
    texte: { ...base, background: "transparent", color: bleuFonce, padding: "10px 12px" },
  };
  return (
    <Link href={href} style={styles[variante]}>
      {children}
    </Link>
  );
}

function Section({
  children,
  fond,
  style,
}: {
  children: React.ReactNode;
  fond?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section style={{ background: fond ?? "#fff", ...style }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px" }}>{children}</div>
    </section>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: bleu, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </p>
  );
}

export default function RootPage() {
  return (
    <main style={{ color: bleuFonce }}>
      {/* Header */}
      <header
        style={{
          borderBottom: `1px solid ${bordure}`,
          position: "sticky",
          top: 0,
          background: "rgba(255,255,255,0.95)",
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 17 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: bleu,
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
            >
              ✓
            </span>
            Atlas Quality Partners
          </div>

          <nav style={{ display: "flex", gap: 20, fontSize: 14, color: grisTexte }}>
            <a href="#solution" style={{ color: "inherit", textDecoration: "none" }}>Solution</a>
            <a href="#garanties" style={{ color: "inherit", textDecoration: "none" }}>Garanties</a>
            <a href="#modalites" style={{ color: "inherit", textDecoration: "none" }}>Modalités</a>
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Bouton href="/connexion?role=ingenieur" variante="texte">Espace Ingénieur</Bouton>
            <Bouton href="/connexion?role=client" variante="contour">Espace Partenaire</Bouton>
            <Bouton href="/connexion" variante="pleine">Connexion</Bouton>
          </div>
        </div>
      </header>

      {/* Hero */}
      <Section fond="linear-gradient(180deg,#f4f7fe 0%,#ffffff 100%)">
        <div style={{ textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
          <Kicker>SOUS-TRAITANCE QA &amp; TESTS LOGICIELS</Kicker>
          <h1 style={{ fontSize: 42, lineHeight: 1.15, margin: "0 0 20px" }}>
            Renforcez votre équipe QA avec des ingénieurs seniors, sans exploser votre budget
          </h1>
          <p style={{ color: grisTexte, fontSize: 16, lineHeight: 1.6, margin: "0 0 28px" }}>
            Notre groupe est né de la rencontre d&apos;ingénieurs QA seniors forts de plusieurs années
            d&apos;expérience à l&apos;étranger. Ensemble, nous renforçons vos équipes techniques avec
            jusqu&apos;à 40% d&apos;économies sur vos coûts de test, sans aucune concession sur la qualité.
          </p>
          <Bouton href="/connexion?role=client">Réserver un appel de 30 minutes</Bouton>
          <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 24, fontSize: 13, color: grisTexte, flexWrap: "wrap" }}>
            <span>✓ NDA systématique</span>
            <span>✓ Conforme RGPD</span>
            <span>✓ Remplacement garanti</span>
          </div>
        </div>
      </Section>

      {/* Stats */}
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 24, textAlign: "center" }}>
          {[
            ["10+ ans", "d'expérience QA & automatisation"],
            ["-40%", "de coût vs une embauche en interne"],
            ["1 interlocuteur", "qui supervise chaque mission"],
          ].map(([chiffre, label]) => (
            <div key={chiffre}>
              <div style={{ fontSize: 28, fontWeight: 700, color: bleu }}>{chiffre}</div>
              <div style={{ color: grisTexte, fontSize: 14, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Solution */}
      <Section fond="#f8f9fc">
        <div id="solution" style={{ scrollMarginTop: 90 }} />
        <Kicker>LA SOLUTION</Kicker>
        <h2 style={{ fontSize: 28, margin: "0 0 12px" }}>Une équipe QA senior, prête à s&apos;intégrer à la vôtre</h2>
        <p style={{ color: grisTexte, maxWidth: 720, lineHeight: 1.6, marginBottom: 32 }}>
          Notre groupe met à votre disposition des ingénieurs QA seniors expérimentés — tests manuels et
          automatisés, intégration dans vos pipelines CI/CD — sélectionnés et supervisés selon un
          référentiel qualité unique, pour garantir un niveau identique à celui d&apos;une équipe interne.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 20 }}>
          {[
            ["Tests automatisés", "Selenium, Playwright, Cypress, TestNG, Cucumber / BDD."],
            ["Tests API & intégration", "Postman, SoapUI, Swagger/OpenAPI, REST Assured."],
            ["CI/CD & supervision qualité", "Jenkins, GitLab CI/CD, GitHub Actions, Jira/XRay."],
            ["Performance & qualité augmentée par l'IA", "k6, JMeter, Applitools, mabl."],
          ].map(([titre, texte]) => (
            <div key={titre} style={{ background: "#fff", border: `1px solid ${bordure}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{titre}</h3>
              <p style={{ color: grisTexte, fontSize: 13, lineHeight: 1.5, margin: 0 }}>{texte}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Comment ça marche */}
      <Section>
        <Kicker>COMMENT ÇA MARCHE</Kicker>
        <h2 style={{ fontSize: 28, margin: "0 0 32px" }}>Trois étapes, sans complexité de votre côté</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 24 }}>
          {[
            ["01", "Appel découverte (30 min)", "On échange sur vos besoins de test, votre stack technique et votre calendrier."],
            ["02", "Sélection du bon profil", "Notre équipe vous présente un ou plusieurs ingénieurs QA seniors adaptés à votre projet."],
            ["03", "Intégration & suivi", "Démarrage rapide, avec un suivi qualité assuré personnellement tout au long de la mission."],
          ].map(([n, titre, texte]) => (
            <div key={n}>
              <div style={{ color: bleu, fontWeight: 700, fontSize: 22, marginBottom: 8 }}>{n}</div>
              <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>{titre}</h3>
              <p style={{ color: grisTexte, fontSize: 13, lineHeight: 1.5, margin: 0 }}>{texte}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Garanties */}
      <Section fond="#f8f9fc">
        <div id="garanties" style={{ scrollMarginTop: 90 }} />
        <Kicker>GARANTIES &amp; MÉTHODOLOGIE</Kicker>
        <h2 style={{ fontSize: 28, margin: "0 0 32px" }}>Un cadre structuré, pas une simple mise en relation</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 20 }}>
          {[
            ["Sélection rigoureuse", "Entretien technique approfondi et test pratique sur votre stack avant toute proposition."],
            ["Reporting hebdomadaire", "Couverture de tests, anomalies détectées et avancement, formalisés chaque semaine."],
            ["Confidentialité garantie", "NDA systématique et traitement des données conforme au RGPD."],
            ["Garantie de remplacement", "Si un profil ne correspond pas à vos attentes, il est remplacé sans frais."],
            ["Pilotage centralisé", "Un point de contact unique coordonne toutes les missions."],
            ["Montée en charge flexible", "Le dimensionnement de l'équipe s'ajuste à vos pics d'activité."],
          ].map(([titre, texte]) => (
            <div key={titre} style={{ background: "#fff", border: `1px solid ${bordure}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{titre}</h3>
              <p style={{ color: grisTexte, fontSize: 13, lineHeight: 1.5, margin: 0 }}>{texte}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Modalités */}
      <Section>
        <div id="modalites" style={{ scrollMarginTop: 90 }} />
        <Kicker>MODALITÉS D&apos;ENGAGEMENT</Kicker>
        <h2 style={{ fontSize: 28, margin: "0 0 32px" }}>Un format adapté à votre besoin réel</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 20 }}>
          {[
            ["Mission ponctuelle", "Renfort ciblé sur une campagne de tests ou un pic de charge, sur quelques semaines."],
            ["Temps partagé", "Un ingénieur QA senior engagé sur la durée, à temps partiel."],
            ["QA à temps plein", "Un ingénieur QA senior consacré à 100% à une seule mission."],
            ["Équipe dédiée", "Une équipe QA complète intégrée à votre organisation."],
          ].map(([titre, texte]) => (
            <div key={titre} style={{ border: `1px solid ${bordure}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{titre}</h3>
              <p style={{ color: grisTexte, fontSize: 13, lineHeight: 1.5, margin: 0 }}>{texte}</p>
            </div>
          ))}
        </div>
        <p style={{ color: grisTexte, fontSize: 13, marginTop: 20 }}>Tarification adaptée à chaque mission, sur devis.</p>
      </Section>

      {/* CTA finale */}
      <Section fond={bleuFonce}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <h2 style={{ fontSize: 26, margin: "0 0 12px" }}>Discutons de vos besoins de test en 30 minutes</h2>
          <p style={{ opacity: 0.8, margin: "0 0 24px" }}>
            Pas d&apos;engagement — juste un échange pour voir si une équipe QA nearshore a du sens pour vous.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Bouton href="/connexion?role=client">Réserver un appel de 30 minutes</Bouton>
            <Bouton href="/inscription?role=ingenieur" variante="contour">Rejoindre en tant qu&apos;ingénieur</Bouton>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${bordure}`, padding: "24px", fontSize: 13, color: grisTexte, textAlign: "center" }}>
        © Atlas Quality Partners · contact@atlas-qa.com · atlas-qa.com
      </footer>
    </main>
  );
}
