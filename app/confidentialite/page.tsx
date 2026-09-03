import Link from "next/link";

const bleu = "#2557d6";
const bleuFonce = "#12224a";
const grisTexte = "#4b5567";
const bordure = "#e4e7ee";

// Politique de confidentialité (RGPD) — accessible publiquement, liée depuis
// /inscription (case à consentement) et depuis l'onglet "Mon compte" de
// l'espace ingénieur. Rédigée pour un vivier international (ingénieurs hors
// UE inclus) : le responsable de traitement reste basé en France/UE, ce qui
// s'applique quel que soit le pays de résidence de l'ingénieur.
export default function ConfidentialitePage() {
  return (
    <main style={{ color: bleuFonce }}>
      <header style={{ borderBottom: `1px solid ${bordure}`, padding: "20px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link href="/" style={{ fontWeight: 700, color: bleuFonce, textDecoration: "none" }}>
            Atlas Quality Partners
          </Link>
          <Link href="/" style={{ fontSize: 13, color: bleu, textDecoration: "none" }}>
            ← Retour à l&apos;accueil
          </Link>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 80px" }}>
        <p style={{ color: bleu, fontWeight: 700, fontSize: 13, letterSpacing: 0.6, marginBottom: 12 }}>
          RGPD &amp; PROTECTION DES DONNÉES
        </p>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Politique de confidentialité</h1>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 32 }}>Dernière mise à jour : septembre 2026</p>

        <Section titre="Responsable du traitement">
          <p>
            Atlas Quality Partners est responsable du traitement des données personnelles collectées via ce site,
            que vous soyez ingénieur candidat, ingénieur en mission ou client (« partenaire »). Pour toute question
            ou pour exercer vos droits, contactez-nous à{" "}
            <a href="mailto:contact@atlas-qa.com" style={{ color: bleu }}>contact@atlas-qa.com</a>.
          </p>
        </Section>

        <Section titre="Données collectées">
          <p>Selon votre profil, nous traitons notamment :</p>
          <ul style={{ paddingLeft: 20, margin: "8px 0" }}>
            <li>identité et coordonnées (nom, email, téléphone) ;</li>
            <li>votre CV et les informations professionnelles qui en sont extraites (expérience, compétences, formation) ;</li>
            <li>votre disponibilité, votre préavis, votre prétention salariale (TJM souhaité) ;</li>
            <li>votre nationalité et votre pays de résidence, utilisés uniquement pour vous proposer un type de contrat conforme à la réglementation applicable ;</li>
            <li>pour un compte partenaire : raison sociale, identifiant d&apos;entreprise, contact référent.</li>
          </ul>
        </Section>

        <Section titre="Finalité et base légale">
          <p>
            Ces données sont traitées pour vous mettre en relation avec des missions ou des profils d&apos;ingénieurs
            correspondant à vos besoins, gérer votre compte et assurer le suivi des missions en cours. Le traitement
            repose sur votre consentement, recueilli à l&apos;inscription, ainsi que sur l&apos;exécution de mesures
            précontractuelles à votre demande (article 6.1.a et 6.1.b du RGPD).
          </p>
        </Section>

        <Section titre="Conformité internationale et réglementation applicable au contrat">
          <p>
            Le type de contrat proposé (freelance, portage salarial, salariat) dépend à la fois de votre pays de
            résidence et de votre nationalité, afin de respecter le droit local applicable à l&apos;exercice d&apos;une
            activité indépendante — par exemple, la libre installation en freelance en France ou en Europe suppose
            une nationalité de l&apos;Union européenne, de l&apos;EEE ou de la Suisse, ou une autorisation de travail
            indépendant adaptée. Cette information reste indicative et est toujours confirmée avec vous avant tout
            contrat.
          </p>
        </Section>

        <Section titre="Destinataires">
          <p>
            Vos données sont accessibles à l&apos;équipe Atlas Quality Partners. Votre CV n&apos;est transmis à un
            client potentiel qu&apos;après votre accord préalable, dans le cadre d&apos;une proposition de mission —
            il n&apos;est jamais rendu public.
          </p>
        </Section>

        <Section titre="Durée de conservation">
          <p>
            Vos données sont conservées tant que votre compte est actif dans notre vivier. Vous pouvez à tout moment
            désactiver temporairement votre profil ou demander sa suppression définitive depuis l&apos;onglet « Mon
            compte » de votre espace ingénieur.
          </p>
        </Section>

        <Section titre="Vos droits">
          <p>Conformément au RGPD et, le cas échéant, aux réglementations équivalentes de votre pays de résidence, vous disposez d&apos;un droit :</p>
          <ul style={{ paddingLeft: 20, margin: "8px 0" }}>
            <li>d&apos;accès à vos données ;</li>
            <li>de rectification ;</li>
            <li>d&apos;effacement (« droit à l&apos;oubli »), disponible directement depuis votre espace ;</li>
            <li>à la limitation du traitement ;</li>
            <li>à la portabilité de vos données ;</li>
            <li>d&apos;opposition, et de retrait de votre consentement à tout moment.</li>
          </ul>
          <p>
            Pour exercer ces droits, écrivez à{" "}
            <a href="mailto:contact@atlas-qa.com" style={{ color: bleu }}>contact@atlas-qa.com</a>. Vous disposez
            également du droit d&apos;introduire une réclamation auprès de l&apos;autorité de protection des données
            compétente (la CNIL en France, ou l&apos;autorité équivalente de votre pays de résidence).
          </p>
        </Section>

        <Section titre="Sécurité">
          <p>
            Votre CV est stocké de façon privée et n&apos;est accessible qu&apos;après authentification — aucune URL
            publique n&apos;est générée. La connexion à votre espace repose sur un cookie de session sécurisé,
            strictement nécessaire au fonctionnement du site (aucun cookie de suivi publicitaire ou tiers).
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>{titre}</h2>
      <div style={{ fontSize: 14, color: grisTexte, lineHeight: 1.6 }}>{children}</div>
    </section>
  );
}
