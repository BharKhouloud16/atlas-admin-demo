"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DISPONIBILITES, STATUTS_EN_MISSION, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";
import { PAYS, NATIONALITES, DEVISES, calculerRegimeSuggere } from "@/lib/localisation";

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
  disponibilitePrevue: string | null;
  changerMissionActuelle: boolean | null;
  missionApres: string | null;
  preavis: string | null;
  preavisPrecision: string | null;
  nationalite: string | null;
  nationalitePrecision: string | null;
  paysResidence: string | null;
  paysResidencePrecision: string | null;
  regimeSuggere: string | null;
  tjmSouhaite: number | null;
  tjmSouhaiteDevise: string | null;
  disponibiliteRenseigneeLe: string | null;
  infosCv: InfoCV[];
  missions: Mission[];
};

const ONGLETS = ["Profil", "Historique de mission avec Atlas", "Documents", "Emploi du temps", "Mon compte"] as const;
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

  const missionActive = data.missions.some((m) => m.statut === "En cours");

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 24, display: "flex", gap: 32 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{data.nom}</h1>
          <StatutBadge data={data} missionActive={missionActive} />
        </div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Espace ingénieur</p>

        {onglet === "Profil" && <OngletProfil data={data} recharger={recharger} />}
        {onglet === "Historique de mission avec Atlas" && <OngletHistorique missions={data.missions} />}
        {onglet === "Documents" && <OngletDocuments data={data} />}
        {onglet === "Emploi du temps" && <OngletEmploiDuTemps missionActive={missionActive} />}
        {onglet === "Mon compte" && <OngletCompte missionActive={missionActive} />}
      </div>

      <nav style={{ width: 220, flexShrink: 0 }}>
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {ONGLETS.map((o) => {
            const verrouille = o === "Emploi du temps" && !missionActive;
            return (
              <li key={o}>
                <button
                  onClick={() => !verrouille && setOnglet(o)}
                  disabled={verrouille}
                  title={verrouille ? "Disponible dès que vous êtes en mission avec Atlas" : undefined}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid " + (onglet === o ? "#111" : "#e4e7ee"),
                    background: onglet === o ? "#111" : "#fff",
                    color: onglet === o ? "#fff" : verrouille ? "#aab0ba" : "#111",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: verrouille ? "not-allowed" : "pointer",
                  }}
                >
                  {o}
                  {verrouille && <span style={{ fontWeight: 400, fontSize: 11 }}> (verrouillé)</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </main>
  );
}

// Petit indicateur "lumineux" en haut du profil, résumant la situation de
// l'ingénieur d'un coup d'œil : en mission réelle avec Atlas (prioritaire),
// sinon d'après ses réponses au questionnaire de disponibilité.
function StatutBadge({ data, missionActive }: { data: ProfilData; missionActive: boolean }) {
  let label = "Non renseigné";
  let couleur = "#9aa0ab";

  if (missionActive) {
    label = "En mission avec Atlas";
    couleur = "#2563eb";
  } else if (data.disponibilite === "Disponible immédiatement") {
    label = "Disponible";
    couleur = "#16a34a";
  } else if (data.disponibilite === "En mission actuellement chez Atlas") {
    label = "En mission chez Atlas (déclaré)";
    couleur = "#2563eb";
  } else if (data.disponibilite === "En mission actuellement chez un autre client") {
    label = "En mission chez un autre client";
    couleur = "#7c3aed";
  } else if (data.disponibilite === "Non disponible immédiatement") {
    label = data.disponibilitePrevue ? `Non disponible (prévu : ${data.disponibilitePrevue})` : "Non disponible";
    couleur = "#dc2626";
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: couleur + "1a",
        border: `1px solid ${couleur}`,
        fontSize: 12,
        fontWeight: 600,
        color: couleur,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: couleur,
          boxShadow: `0 0 6px ${couleur}`,
        }}
      />
      {label}
    </span>
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
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
          Disponibilité &amp; localisation
        </p>
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
  const [disponibilitePrevue, setDisponibilitePrevue] = useState(data.disponibilitePrevue ?? "");
  const [changerMissionActuelle, setChangerMissionActuelle] = useState(
    data.changerMissionActuelle === true ? "oui" : data.changerMissionActuelle === false ? "non" : ""
  );
  const [missionApres, setMissionApres] = useState(data.missionApres ?? "");
  const [preavis, setPreavis] = useState(data.preavis ?? "");
  const [preavisPrecision, setPreavisPrecision] = useState(data.preavisPrecision ?? "");
  const [nationalite, setNationalite] = useState(data.nationalite ?? "");
  const [nationalitePrecision, setNationalitePrecision] = useState(data.nationalitePrecision ?? "");
  const [paysResidence, setPaysResidence] = useState(data.paysResidence ?? "");
  const [paysResidencePrecision, setPaysResidencePrecision] = useState(data.paysResidencePrecision ?? "");
  const [tjmSouhaite, setTjmSouhaite] = useState(data.tjmSouhaite != null ? String(data.tjmSouhaite) : "");
  const [tjmSouhaiteDevise, setTjmSouhaiteDevise] = useState(data.tjmSouhaiteDevise ?? "EUR");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  const enMission = STATUTS_EN_MISSION.includes(disponibilite);
  const nonDisponible = disponibilite === "Non disponible immédiatement";
  const regimeApercu = calculerRegimeSuggere(paysResidence);

  async function enregistrer() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/disponibilite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disponibilite,
        disponibilitePrevue: nonDisponible ? disponibilitePrevue : undefined,
        changerMissionActuelle: enMission ? changerMissionActuelle === "oui" : undefined,
        missionApres: enMission ? missionApres : undefined,
        preavis,
        preavisPrecision,
        nationalite,
        nationalitePrecision,
        paysResidence,
        paysResidencePrecision,
        tjmSouhaite: Number(tjmSouhaite),
        tjmSouhaiteDevise,
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
        {data.disponibilite === "Non disponible immédiatement" && (
          <Ligne label="Prévision de disponibilité" valeur={data.disponibilitePrevue} />
        )}
        {STATUTS_EN_MISSION.includes(data.disponibilite ?? "") && (
          <>
            <Ligne label="Souhaite changer" valeur={data.changerMissionActuelle ? "Oui" : "Non"} />
            <Ligne label="Après la mission" valeur={data.missionApres} />
          </>
        )}
        <Ligne label="Préavis" valeur={data.preavis === "Autre" ? data.preavisPrecision : data.preavis} />
        <Ligne label="Nationalité" valeur={data.nationalite === "Autre" ? data.nationalitePrecision : data.nationalite} />
        <Ligne label="Pays de résidence" valeur={data.paysResidence === "Autre" ? data.paysResidencePrecision : data.paysResidence} />
        <Ligne
          label="Prétention salariale (TJM souhaité)"
          valeur={data.tjmSouhaite != null ? `${data.tjmSouhaite} ${data.tjmSouhaiteDevise ?? ""}`.trim() : null}
        />
        {data.regimeSuggere && (
          <p style={{ fontSize: 13, color: "#4b5567", margin: "4px 0 0", background: "#f6f7fa", padding: 8, borderRadius: 6 }}>
            <strong>Profil suggéré : </strong>
            {data.regimeSuggere}
          </p>
        )}
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
      {nonDisponible && (
        <div>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Prévision de disponibilité</p>
          <input
            type="text"
            placeholder="Ex : disponible à partir du 15 octobre, dans 2 mois..."
            value={disponibilitePrevue}
            onChange={(e) => setDisponibilitePrevue(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </div>
      )}
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
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Nationalité</p>
        <select value={nationalite} onChange={(e) => setNationalite(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {NATIONALITES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {nationalite === "Autre" && (
          <input
            type="text"
            value={nationalitePrecision}
            onChange={(e) => setNationalitePrecision(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 6 }}
          />
        )}
      </div>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Pays de résidence</p>
        <select value={paysResidence} onChange={(e) => setPaysResidence(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {PAYS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {paysResidence === "Autre" && (
          <input
            type="text"
            value={paysResidencePrecision}
            onChange={(e) => setPaysResidencePrecision(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 6 }}
          />
        )}
        {regimeApercu && (
          <p style={{ fontSize: 12, color: "#4b5567", marginTop: 8, background: "#f6f7fa", padding: 8, borderRadius: 6 }}>
            <strong>Profil suggéré :</strong> {regimeApercu}
          </p>
        )}
      </div>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Prétention salariale (TJM souhaité)</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            min={0}
            value={tjmSouhaite}
            onChange={(e) => setTjmSouhaite(e.target.value)}
            style={{ flex: 1, padding: 6 }}
          />
          <select value={tjmSouhaiteDevise} onChange={(e) => setTjmSouhaiteDevise(e.target.value)} style={{ padding: 6 }}>
            {DEVISES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
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

// Gestion du compte par l'ingénieur lui-même : désactivation temporaire
// (réversible, voir /ingenieur/compte-desactive) ou suppression définitive
// du profil (voir app/api/ingenieur/compte/route.ts).
function OngletCompte({ missionActive }: { missionActive: boolean }) {
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [confirmationDesactivation, setConfirmationDesactivation] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);

  async function desactiver() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/compte/desactiver", { method: "POST" });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    router.push("/connexion?desactive=1");
  }

  async function supprimer() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/compte", { method: "DELETE" });
    setEnvoi(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    router.push("/connexion?supprime=1");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
      {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}

      <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 16 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 8px" }}>Désactiver temporairement mon profil</p>
        <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
          Votre profil devient invisible et vous serez déconnecté(e). Vous pourrez le réactiver à tout moment en
          vous reconnectant avec vos identifiants habituels.
        </p>
        {!confirmationDesactivation ? (
          <button onClick={() => setConfirmationDesactivation(true)} style={{ padding: "8px 16px", fontSize: 13 }}>
            Désactiver mon profil
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 13, margin: 0 }}>Confirmez : vous serez immédiatement déconnecté(e).</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={desactiver} disabled={envoi} style={{ padding: "8px 16px", fontSize: 13 }}>
                {envoi ? "..." : "Oui, désactiver"}
              </button>
              <button onClick={() => setConfirmationDesactivation(false)} style={{ padding: "8px 16px", fontSize: 13 }}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ border: "1px solid #f3d2d2", borderRadius: 8, padding: 16 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 8px", color: "#b3261e" }}>
          Supprimer définitivement mon profil
        </p>
        <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
          Action irréversible : votre profil, votre CV et vos informations seront définitivement supprimés.
          {missionActive &&
            " Vous avez une mission en cours avec Atlas : la suppression n'est possible qu'après clôture de celle-ci (contactez l'administrateur)."}
        </p>
        {!confirmationSuppression ? (
          <button
            onClick={() => setConfirmationSuppression(true)}
            style={{ padding: "8px 16px", fontSize: 13, color: "#b3261e", borderColor: "#b3261e" }}
          >
            Supprimer définitivement
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 13, margin: 0 }}>Êtes-vous certain(e) ? Cette action est définitive.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={supprimer}
                disabled={envoi}
                style={{ padding: "8px 16px", fontSize: 13, background: "#b3261e", color: "#fff", border: "none", borderRadius: 6 }}
              >
                {envoi ? "..." : "Oui, tout supprimer"}
              </button>
              <button onClick={() => setConfirmationSuppression(false)} style={{ padding: "8px 16px", fontSize: 13 }}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OngletEmploiDuTemps({ missionActive }: { missionActive: boolean }) {
  if (!missionActive) {
    return (
      <p style={{ fontSize: 14, color: "#4b5567" }}>
        Cette rubrique s'active dès que vous êtes en mission avec Atlas Quality Partners. Vous pourrez alors
        déclarer vos jours travaillés et vos heures supplémentaires, pour validation par l'administrateur puis
        par le client, avant facturation.
      </p>
    );
  }

  return (
    <p style={{ fontSize: 14, color: "#4b5567" }}>
      La saisie de votre temps de travail (jours travaillés, heures supplémentaires) arrive prochainement.
      Elle sera ensuite soumise à validation de l'administrateur puis du client avant facturation.
    </p>
  );
}
