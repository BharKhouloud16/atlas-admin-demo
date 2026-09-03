"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DISPONIBILITES, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";
import { PAYS, calculerRegimeSuggere } from "@/lib/localisation";

export default function DisponibilitePage() {
  const router = useRouter();
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  const [disponibilite, setDisponibilite] = useState("");
  const [changerMissionActuelle, setChangerMissionActuelle] = useState<string>("");
  const [missionApres, setMissionApres] = useState("");
  const [preavis, setPreavis] = useState("");
  const [preavisPrecision, setPreavisPrecision] = useState("");
  const [nationalite, setNationalite] = useState("");
  const [paysResidence, setPaysResidence] = useState("");
  const [paysResidencePrecision, setPaysResidencePrecision] = useState("");

  useEffect(() => {
    fetch("/api/ingenieur/disponibilite")
      .then((r) => r.json())
      .then((data) => {
        if (data?.disponibilite) setDisponibilite(data.disponibilite);
        if (typeof data?.changerMissionActuelle === "boolean") {
          setChangerMissionActuelle(data.changerMissionActuelle ? "oui" : "non");
        }
        if (data?.missionApres) setMissionApres(data.missionApres);
        if (data?.preavis) setPreavis(data.preavis);
        if (data?.preavisPrecision) setPreavisPrecision(data.preavisPrecision);
        if (data?.nationalite) setNationalite(data.nationalite);
        if (data?.paysResidence) setPaysResidence(data.paysResidence);
        if (data?.paysResidencePrecision) setPaysResidencePrecision(data.paysResidencePrecision);
        setChargement(false);
      });
  }, []);

  const enMission = disponibilite === "En mission actuellement";
  const regimeApercu = calculerRegimeSuggere(paysResidence);

  async function valider() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/disponibilite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disponibilite,
        changerMissionActuelle: enMission ? changerMissionActuelle === "oui" : undefined,
        missionApres: enMission ? missionApres : undefined,
        preavis,
        preavisPrecision,
        nationalite,
        paysResidence,
        paysResidencePrecision,
      }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const data = await res.json();
      setErreur(data.error ?? "Erreur.");
      return;
    }
    router.push("/ingenieur");
  }

  if (chargement) {
    return <main style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>Chargement...</main>;
  }

  const pretAValider =
    disponibilite &&
    preavis &&
    (preavis !== "Autre" || preavisPrecision.trim()) &&
    (!enMission || (changerMissionActuelle && missionApres)) &&
    nationalite.trim() &&
    paysResidence &&
    (paysResidence !== "Autre" || paysResidencePrecision.trim());

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Votre disponibilité</h1>
      <p style={{ fontSize: 13, color: "#4b5567", marginBottom: 24 }}>
        Quelques questions rapides pour compléter votre profil avant d'accéder à votre espace.
      </p>

      <div style={{ border: "1px solid #e4e7ee", borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
            Quel est votre statut actuel ?
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {DISPONIBILITES.map((option) => (
              <label key={option} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input
                  type="radio"
                  name="disponibilite"
                  checked={disponibilite === option}
                  onChange={() => setDisponibilite(option)}
                />
                {option}
              </label>
            ))}
          </div>
        </div>

        {enMission && (
          <>
            <div>
              <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
                Souhaitez-vous changer de mission ?
              </label>
              <div style={{ display: "flex", gap: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <input
                    type="radio"
                    name="changerMission"
                    checked={changerMissionActuelle === "oui"}
                    onChange={() => setChangerMissionActuelle("oui")}
                  />
                  Oui
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <input
                    type="radio"
                    name="changerMission"
                    checked={changerMissionActuelle === "non"}
                    onChange={() => setChangerMissionActuelle("non")}
                  />
                  Non
                </label>
              </div>
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
                À l'issue de votre mission actuelle ?
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {MISSIONS_APRES.map((option) => (
                  <label key={option} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <input
                      type="radio"
                      name="missionApres"
                      checked={missionApres === option}
                      onChange={() => setMissionApres(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div>
          <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
            Quel est votre préavis ?
          </label>
          <select
            value={preavis}
            onChange={(e) => setPreavis(e.target.value)}
            style={{ width: "100%", padding: 8, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit" }}
          >
            <option value="">Sélectionnez...</option>
            {PREAVIS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {preavis === "Autre" && (
            <input
              type="text"
              placeholder="Précisez votre préavis..."
              value={preavisPrecision}
              onChange={(e) => setPreavisPrecision(e.target.value)}
              style={{ width: "100%", padding: 8, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit", marginTop: 8 }}
            />
          )}
        </div>

        <div>
          <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
            Quelle est votre nationalité ?
          </label>
          <input
            type="text"
            placeholder="Ex : Française, Tunisienne..."
            value={nationalite}
            onChange={(e) => setNationalite(e.target.value)}
            style={{ width: "100%", padding: 8, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit" }}
          />
        </div>

        <div>
          <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 8 }}>
            Dans quel pays résidez-vous ?
          </label>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
            Cette information nous permet de vous proposer un profil et un type de contrat adaptés à votre
            situation.
          </p>
          <select
            value={paysResidence}
            onChange={(e) => setPaysResidence(e.target.value)}
            style={{ width: "100%", padding: 8, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit" }}
          >
            <option value="">Sélectionnez...</option>
            {PAYS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {paysResidence === "Autre" && (
            <input
              type="text"
              placeholder="Précisez votre pays..."
              value={paysResidencePrecision}
              onChange={(e) => setPaysResidencePrecision(e.target.value)}
              style={{ width: "100%", padding: 8, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit", marginTop: 8 }}
            />
          )}
          {regimeApercu && (
            <p style={{ fontSize: 12, color: "#4b5567", marginTop: 8, background: "#f6f7fa", padding: 8, borderRadius: 6 }}>
              <strong>Profil suggéré :</strong> {regimeApercu}
            </p>
          )}
        </div>

        {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={valider} disabled={!pretAValider || envoi} style={{ padding: "8px 20px", fontWeight: 600 }}>
            {envoi ? "Envoi..." : "Valider et continuer"}
          </button>
        </div>
      </div>
    </main>
  );
}
