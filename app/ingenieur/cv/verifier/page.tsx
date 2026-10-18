"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { bleu, bleuFonce, grisTexte, bordure, fondClair, rouge, orange } from "@/lib/theme";

// ATLAS ENGINEER INTELLIGENCE PROFILE — Phase 1 (28/09/2026).
//
// Remplace l'ancien parcours "un champ à la fois -> OK -> champ suivant"
// (jamais couvert par un test automatisé, confirmé par grep exhaustif avant
// cette réécriture) par un écran unique : tous les champs extraits du CV
// sont visibles et modifiables simultanément, groupés par catégorie, dans
// n'importe quel ordre. L'URL reste /ingenieur/cv/verifier (voir
// app/ingenieur/page.tsx, qui y redirige tant que cvValide=false) pour
// éviter toute migration de lien inutile — seul le CONTENU change.
//
// Ce que cet écran NE fait PAS (délibérément, voir diagnostic validé) :
// - il n'expose aucune donnée du Skill Graph interne (ProfilCompetence/
//   SkillEvidence/statut VERIFIE-DECLARE-INFERE) : cette infrastructure
//   reste strictement Admin-only, inchangée, invisible ici ;
// - il ne fabrique aucune séniorité/TJM/points forts calculés : voir
//   app/api/ingenieur/cv/finaliser/route.ts, qui ne copie QUE les deux
//   champs réellement extraits par l'IA (années d'expérience, séniorité),
//   jamais une donnée sans source réelle.
type InfoCV = {
  id: string;
  categorie: string;
  libelle: string;
  valeur: string;
  ordre: number;
  valide: boolean;
};

// Libellés de section affichés à l'ingénieur, pour chaque `categorie`
// InfoCV réellement produite par lib/cv-extraction.ts (voir MODELE_CHAMPS_CV).
// "Mobilité & disponibilité" reste une étape séparée (app/ingenieur/
// disponibilite) : ce ne sont pas des InfoCV, on ne les fabrique pas ici.
const LIBELLES_SECTIONS: Record<string, string> = {
  identite: "Identité",
  contact: "Coordonnées",
  profil: "Profil professionnel",
  competence: "Compétences & langues",
  experience: "Expérience",
  formation: "Formation & certifications",
};

export default function VerifierCVPage() {
  const router = useRouter();
  const [infos, setInfos] = useState<InfoCV[] | null>(null);
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const [valeursInitiales, setValeursInitiales] = useState<Record<string, string>>({});
  const [extractionEchouee, setExtractionEchouee] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Lu directement depuis l'URL plutôt que via useSearchParams, même
    // convention que app/reinitialiser-mot-de-passe/page.tsx (évite toute
    // contrainte de Suspense boundary au build pour un simple indicateur).
    setExtractionEchouee(new URLSearchParams(window.location.search).get("extraction") === "echec");

    fetch("/api/ingenieur/cv/infos")
      .then((r) => r.json())
      .then((data: InfoCV[]) => {
        setInfos(data);
        const init: Record<string, string> = {};
        for (const info of data) init[info.id] = info.valeur;
        setValeurs(init);
        setValeursInitiales(init);
      });
  }, []);

  if (!infos) {
    return <main style={{ maxWidth: 720, margin: "80px auto", padding: 24 }}>Chargement...</main>;
  }

  if (infos.length === 0) {
    return (
      <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
        <p>Aucun CV importé.</p>
        <button onClick={() => router.push("/ingenieur/cv")}>Importer mon CV</button>
      </main>
    );
  }

  // Groupe par catégorie en conservant l'ordre déjà renvoyé par l'API (tri
  // par `ordre` croissant) — jamais un ré-ordonnancement arbitraire.
  const sections: { categorie: string; champs: InfoCV[] }[] = [];
  for (const info of infos) {
    const section = sections.find((s) => s.categorie === info.categorie);
    if (section) section.champs.push(info);
    else sections.push({ categorie: info.categorie, champs: [info] });
  }

  async function continuer() {
    setError("");
    setLoading(true);
    try {
      const appels: Promise<Response>[] = [];
      for (const info of infos!) {
        const modifie = valeurs[info.id] !== valeursInitiales[info.id];
        if (modifie) {
          appels.push(
            fetch("/api/ingenieur/cv/infos", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: info.id, valeur: valeurs[info.id], valide: true }),
            })
          );
        } else if (!info.valide) {
          // Pas modifié, mais pas encore validé (ex. première visite d'un
          // profil extrait automatiquement) : POST /finaliser exige que
          // tout soit `valide` (voir app/api/ingenieur/cv/finaliser/route.ts)
          // — jamais de saisie forcée pour autant, voir section 5 du mandat.
          appels.push(
            fetch("/api/ingenieur/cv/infos", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: info.id, valide: true }),
            })
          );
        }
      }

      const reponses = await Promise.all(appels);
      const echec = reponses.find((r) => !r.ok);
      if (echec) {
        const data = await echec.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de l'enregistrement.");
        setLoading(false);
        return;
      }

      const resFinal = await fetch("/api/ingenieur/cv/finaliser", { method: "POST" });
      const dataFinal = await resFinal.json();
      if (!resFinal.ok) {
        setError(dataFinal.error ?? "Erreur.");
        setLoading(false);
        return;
      }
      router.push("/ingenieur/disponibilite");
    } catch {
      setError("Erreur réseau. Réessayez.");
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 4, color: bleuFonce }}>Votre profil</h1>
      <p style={{ fontSize: 14, color: grisTexte, marginBottom: 20 }}>
        ATLAS a extrait ces informations de votre CV. Vérifiez-les et corrigez ce qui doit l&apos;être,
        dans n&apos;importe quel ordre, puis continuez.
      </p>

      {extractionEchouee && (
        <div
          style={{
            background: "#fff7ed",
            border: `1px solid ${orange}`,
            borderRadius: 8,
            padding: 14,
            marginBottom: 20,
            fontSize: 13,
            color: bleuFonce,
          }}
        >
          L&apos;extraction automatique n&apos;a pas pu être effectuée. Vous pouvez compléter votre
          profil manuellement.
        </div>
      )}

      {sections.map((section) => (
        <div key={section.categorie} style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: bleu,
              fontWeight: 700,
              marginBottom: 10,
              paddingBottom: 6,
              borderBottom: `1px solid ${bordure}`,
            }}
          >
            {LIBELLES_SECTIONS[section.categorie] ?? section.categorie}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {section.champs.map((champ) => (
              <div key={champ.id}>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6, color: bleuFonce }}>
                  {champ.libelle}
                </label>
                <textarea
                  value={valeurs[champ.id] ?? ""}
                  onChange={(e) => setValeurs((v) => ({ ...v, [champ.id]: e.target.value }))}
                  placeholder="Saisissez ou corrigez cette information..."
                  rows={champ.categorie === "experience" ? 2 : 1}
                  style={{
                    width: "100%",
                    padding: 8,
                    border: `1px solid ${bordure}`,
                    borderRadius: 6,
                    fontFamily: "inherit",
                    fontSize: 14,
                    background: fondClair,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {error && <p style={{ color: rouge, fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <button
        onClick={continuer}
        disabled={loading}
        style={{
          padding: "10px 24px",
          fontWeight: 600,
          background: bleu,
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "Enregistrement..." : "Continuer"}
      </button>
    </main>
  );
}
