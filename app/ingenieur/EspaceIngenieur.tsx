"use client";

import { useEffect, useState } from "react";
import { DISPONIBILITES, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";

type InfoCV = {
  id: string;
  categorie: string;
  libelle: string;
  valeur: string;
  ordre: number;
};

type Mission = {
  id: string;
  repere: string | null;
  statut: string;
  nbJours: number;
  createdAt: string;
  client: { nom: string };
};

type ProfilData = {
  nom: string;
  cvNomFichier: string | null;
  cvImporteLe: string | null;
  disponibilite: string | null;
  changerMissionActuelle: boolean | null;
  missionApres: string | null;
  preavis: string | null;
  preavisPrecision: string | null;
  disponibiliteRenseigneeLe: string | null;
  infosCv: InfoCV[];
  missions: Mission[];
};

const ONGLETS = ["Profil", "Historique de mission avec Atlas", "Documents", "Emploi du temps"] as const;
type Onglet = (typeof ONGLETS)[number];

export default function EspaceIngenieur() {
  const [data, setData] = useState<ProfilData | null>(null);
  const [onglet, setOnglet] = useState<Onglet>("Profil");

  function recharger() {
    fetch("/api/ingenieur/profil")
      .then((r) => r.json())
      .then(setData);
  }

  useEffect(recharger, []);

  if (!data) {
    return <main style={{ maxWidth: 900, margin: "60px auto", padding: 24 }}>Chargement...</main>;
  }

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 24, display: "flex", gap: 32 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>{data.nom}</h1>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Espace ingénieur</p>

        {onglet === "Profil" && <OngletProfil data={data} recharger={recharger} />}
        {onglet === "Historique de mission avec Atlas" && <OngletHistorique missions={data.missions} />}
        {onglet === "Documents" && <OngletDocuments data={data} />}
        {onglet === "Emploi du temps" && <OngletEmploiDuTemps />}
      </div>

      <nav style={{ width: 220, flexShrink: 0 }}>
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {ONGLETS.map((o) => (
            <li key={o}>
              <button
                onClick={() => setOnglet(o)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid " + (onglet === o ? "#111" : "#e4e7ee"),
                  background: onglet === o ? "#111" : "#fff",
                  color: onglet === o ? "#fff" : "#111",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

function OngletProfil({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const categories = Array.from(new Set(data.infosCv.map((i) => i.categorie)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {categories.map((cat) => (
        <div key={cat}>
          <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>{cat}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.infosCv
              .filter((i) => i.categorie === cat)
              .map((info) => (
                <ChampEditable key={info.id} info={info} recharger={recharger} />
              ))}
          </div>
        </div>
      ))}

      <div>
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>Disponibilité</p>
        <Disponibilite data={data} recharger={recharger} />
      </div>
    </div>
  );
}

function ChampEditable({ info, recharger }: { info: InfoCV; recharger: () => void }) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(info.valeur);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer() {
    setEnvoi(true);
    await fetch("/api/ingenieur/cv/infos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: info.id, valeur }),
    });
    setEnvoi(false);
    setEdition(false);
    recharger();
  }

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{info.libelle}</p>
      {edition ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            rows={2}
            style={{ flex: 1, padding: 6, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit", fontSize: 14 }}
          />
          <button onClick={enregistrer} disabled={envoi} style={{ padding: "6px 12px", fontSize: 13 }}>
            {envoi ? "..." : "Enregistrer"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 14, margin: 0 }}>{info.valeur || "—"}</p>
          <button onClick={() => setEdition(true)} style={{ fontSize: 12, padding: "4px 10px", flexShrink: 0 }}>
            Modifier
          </button>
        </div>
      )}
    </div>
  );
}

function Disponibilite({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const [edition, setEdition] = useState(false);
  const [disponibilite, setDisponibilite] = useState(data.disponibilite ?? "");
  const [changerMissionActuelle, setChangerMissionActuelle] = useState(
    data.changerMissionActuelle === true ? "oui" : data.changerMissionActuelle === false ? "non" : ""
  );
  const [missionApres, setMissionApres] = useState(data.missionApres ?? "");
  const [preavis, setPreavis] = useState(data.preavis ?? "");
  const [preavisPrecision, setPreavisPrecision] = useState(data.preavisPrecision ?? "");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  const enMission = disponibilite === "En mission actuellement";

  async function enregistrer() {
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
      }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json();
      setErreur(d.error ?? "Erreur.");
      return;
    }
    setEdition(false);
    recharger();
  }

  if (!edition) {
    return (
      <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <Ligne label="Statut" valeur={data.disponibilite} />
        {data.disponibilite === "En mission actuellement" && (
          <>
            <Ligne label="Souhaite changer" valeur={data.changerMissionActuelle ? "Oui" : "Non"} />
            <Ligne label="Après la mission" valeur={data.missionApres} />
          </>
        )}
        <Ligne label="Préavis" valeur={data.preavis === "Autre" ? data.preavisPrecision : data.preavis} />
        <div>
          <button onClick={() => setEdition(true)} style={{ fontSize: 12, padding: "4px 10px" }}>
            Modifier
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Statut</p>
        <select value={disponibilite} onChange={(e) => setDisponibilite(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {DISPONIBILITES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      {enMission && (
        <>
          <div>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Souhaite changer</p>
            <select value={changerMissionActuelle} onChange={(e) => setChangerMissionActuelle(e.target.value)} style={{ width: "100%", padding: 6 }}>
              <option value="">Sélectionnez...</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Après la mission</p>
            <select value={missionApres} onChange={(e) => setMissionApres(e.target.value)} style={{ width: "100%", padding: 6 }}>
              <option value="">Sélectionnez...</option>
              {MISSIONS_APRES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Préavis</p>
        <select value={preavis} onChange={(e) => setPreavis(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {PREAVIS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {preavis === "Autre" && (
          <input
            type="text"
            value={preavisPrecision}
            onChange={(e) => setPreavisPrecision(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 6 }}
          />
        )}
      </div>
      {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={enregistrer} disabled={envoi} style={{ padding: "6px 14px", fontSize: 13 }}>
          {envoi ? "..." : "Enregistrer"}
        </button>
        <button onClick={() => setEdition(false)} style={{ padding: "6px 14px", fontSize: 13 }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: string | null | undefined }) {
  return (
    <p style={{ fontSize: 14, margin: 0 }}>
      <span style={{ color: "#888" }}>{label} : </span>
      {valeur || "—"}
    </p>
  );
}

function OngletHistorique({ missions }: { missions: Mission[] }) {
  if (missions.length === 0) {
    return (
      <p style={{ fontSize: 14, color: "#4b5567" }}>
        Aucune mission avec Atlas Quality Partners pour l'instant. Votre historique apparaîtra ici dès votre
        première mission.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {missions.map((m) => (
        <div key={m.id} style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{m.client.nom}{m.repere ? ` — ${m.repere}` : ""}</p>
          <p style={{ fontSize: 13, color: "#888", margin: "4px 0 0" }}>
            {m.statut} · {m.nbJours} jour(s) · depuis le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
          </p>
        </div>
      ))}
    </div>
  );
}

function OngletDocuments({ data }: { data: ProfilData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.cvNomFichier ? (
        <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{data.cvNomFichier}</p>
            <p style={{ fontSize: 13, color: "#888", margin: "4px 0 0" }}>
              CV — importé le {data.cvImporteLe ? new Date(data.cvImporteLe).toLocaleDateString("fr-FR") : "—"}
            </p>
          </div>
          <a href="/api/ingenieur/cv/fichier" target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
            Ouvrir
          </a>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "#4b5567" }}>Aucun document pour l'instant.</p>
      )}
      <p style={{ fontSize: 13, color: "#888" }}>
        Les contrats, rapports et factures liés à vos missions apparaîtront ici au fur et à mesure.
      </p>
    </div>
  );
}

function OngletEmploiDuTemps() {
  return (
    <p style={{ fontSize: 14, color: "#4b5567" }}>
      La saisie de votre temps de travail (jours travaillés, heures supplémentaires) arrive prochainement.
      Elle sera ensuite soumise à validation de l'administrateur puis du client avant facturation.
    </p>
  );
}
