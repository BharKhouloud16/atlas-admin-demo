"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleuFonce, grisTexte } from "@/lib/theme";
import { Card, Section, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";
import { LIBELLE_ETAT_ATLAS_OS, type EtatAtlasOs } from "@/lib/atlas-os/etats";
import { Icone } from "@/components/client/Icones";

// LOT 5 (28/10/2026) — ATLAS OS, module OPTIONNEL activé volontairement.
//
// Remplace l'emplacement réservé « Bientôt disponible ». Le module n'est
// jamais actif par défaut : le Client en découvre le contenu réel, demande
// l'activation, et un Admin l'active ou la refuse. Aucun paiement ni
// abonnement n'existe. Ce que l'activation ouvre AUJOURD'HUI est dit tel
// quel (prestations confiées sous forme de projet, lot 6) — aucune
// fonctionnalité non développée n'est présentée comme disponible.

const VARIANT: Record<EtatAtlasOs["etat"], BadgeVariant> = { DISPONIBLE: "info", EN_ATTENTE: "warning", ACTIVE: "success", INDISPONIBLE: "neutral" };

export default function AtlasOSClientPage() {
  const [etat, setEtat] = useState<EtatAtlasOs | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);

  function charger() {
    setErreur(null);
    fetch("/api/client/atlas-os", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setEtat)
      .catch(() => setErreur("Impossible de charger l'état d'ATLAS OS pour le moment."));
  }

  useEffect(() => {
    charger();
  }, []);

  async function demander() {
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch("/api/client/atlas-os", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motif }),
    });
    setEnvoi(false);
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      setErreur(data.error ?? "Une erreur est survenue.");
      return;
    }
    setMotif("");
    setEtat(data);
  }

  // LOT 7 (01/11/2026, planche « ATLAS OS — Option activable ») : présentation,
  // bouton « Activer ATLAS OS » et carte « État de votre option ». Le contenu
  // reste strictement celui qui existe (aucune fonctionnalité annoncée qui ne
  // soit pas développée) ; l'activation reste validée par l'équipe ATLAS.
  const LIBELLE_OPTION: Record<EtatAtlasOs["etat"], string> = { DISPONIBLE: "Disponible", EN_ATTENTE: "En attente de validation", ACTIVE: "Activée", INDISPONIBLE: LIBELLE_ETAT_ATLAS_OS.INDISPONIBLE };
  const libelleEtat = etat ? LIBELLE_OPTION[etat.etat] : null;
  return (
    <Section title="ATLAS OS">
      <p style={{ margin: "-4px 0 16px", fontSize: 13, color: grisTexte }}>Des prestations QA, sécurité et audit pilotées par ATLAS.</p>
      <Card style={{ marginBottom: 16, background: "linear-gradient(135deg, #f3f6fd 0%, #ffffff 70%)" }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <span aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 16, background: bleuFonce, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icone nom="atlasos" taille={34} />
          </span>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: bleuFonce }}>Confiez vos prestations qualité à ATLAS</h2>
            <p style={{ margin: "8px 0 12px", fontSize: 13, color: grisTexte }}>
              ATLAS OS est un module optionnel. Une fois activé, vous pouvez confier à ATLAS des prestations complètes — assurance
              qualité, tests, sécurité, audit — sous forme de projet : ATLAS qualifie votre demande, vous propose une approche, une équipe
              envisagée, des étapes et un budget estimatif, puis en assure le suivi.
            </p>
            <ul style={{ margin: "0 0 14px", padding: 0, listStyle: "none", fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                "Qualification de la prestation à partir de votre description, informations manquantes signalées.",
                "Propositions indicatives puis vérifiées par notre équipe avant tout engagement.",
                "Suivi du projet, de son engagement jusqu'à sa livraison, dans la rubrique Projets.",
              ].map((x) => (
                <li key={x} style={{ display: "flex", gap: 8 }}>
                  <span aria-hidden="true" style={{ color: "#1a7f4b", fontWeight: 700 }}>✓</span>
                  {x}
                </li>
              ))}
            </ul>

            {etat?.etat === "DISPONIBLE" && (
              <>
                <label style={{ fontSize: 12, color: grisTexte, display: "block", maxWidth: 520 }}>
                  Ce que vous souhaitez confier à ATLAS (facultatif)
                  <textarea value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={1000} rows={2} style={{ display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 6, fontFamily: "inherit", boxSizing: "border-box" }} />
                </label>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                  <Bouton onClick={demander} disabled={envoi}>
                    {envoi ? "Envoi…" : "Activer ATLAS OS"}
                  </Bouton>
                  <a href="#etat-option" style={{ fontSize: 13 }}>En savoir plus</a>
                </div>
              </>
            )}
            {etat?.etat === "ACTIVE" && (
              <Link href="/client/projets?type=SERVICE_ATLAS_OS" style={{ display: "inline-block", fontSize: 13, fontWeight: 600, color: "#fff", background: bleuFonce, padding: "8px 14px", borderRadius: 8, textDecoration: "none" }}>
                Confier une prestation ATLAS OS
              </Link>
            )}
          </div>
        </div>
      </Card>

      {erreur && (
        <p role="alert" style={{ color: "#c0392b", fontSize: 13 }}>
          {erreur}
        </p>
      )}

      {etat && (
        <Card>
          <section id="etat-option" aria-labelledby="titre-etat-option">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <h3 id="titre-etat-option" style={{ margin: 0, fontSize: 15, color: bleuFonce }}>État de votre option</h3>
              <Badge variant={VARIANT[etat.etat]}>{libelleEtat}</Badge>
            </div>
            <div style={{ marginTop: 8 }}>
              {etat.etat === "DISPONIBLE" && <p style={{ margin: 0, fontSize: 13 }}>ATLAS OS n&apos;est pas encore activé pour votre compte.</p>}
              {etat.etat === "EN_ATTENTE" && (
                <p role="status" style={{ margin: 0, fontSize: 13 }}>
                  Votre demande d&apos;activation du {new Date(etat.demandeLe!).toLocaleDateString("fr-FR")} est en cours d&apos;examen par
                  l&apos;équipe ATLAS. Vous serez informé de sa décision dans cet espace.
                </p>
              )}
              {etat.etat === "ACTIVE" && (
                <p role="status" style={{ margin: 0, fontSize: 13 }}>
                  ATLAS OS est activé pour votre entreprise{etat.decideLe ? ` depuis le ${new Date(etat.decideLe).toLocaleDateString("fr-FR")}` : ""}.
                </p>
              )}
              {etat.etat === "INDISPONIBLE" && (
                <p style={{ margin: 0, fontSize: 13 }}>
                  ATLAS OS n&apos;est pas disponible pour votre compte pour le moment
                  {etat.motifDecision ? ` : ${etat.motifDecision}` : "."} Pour en savoir plus, écrivez à l&apos;équipe ATLAS depuis la rubrique{" "}
                  <Link href="/client/communication">Communication</Link>.
                </p>
              )}
            </div>
            <p role="note" style={{ margin: "12px 0 0", padding: 10, borderRadius: 8, background: "#f3f6fd", fontSize: 12, color: grisTexte }}>
              L&apos;activation est une option, gratuite et sans engagement : elle est validée par l&apos;équipe ATLAS. Aucun abonnement n&apos;est
              souscrit.
            </p>
          </section>
        </Card>
      )}
    </Section>
  );
}
