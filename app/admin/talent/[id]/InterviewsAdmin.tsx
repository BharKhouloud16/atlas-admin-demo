"use client";

import { useEffect, useState } from "react";
import { bleu, bordure, grisTexte } from "@/lib/theme";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §16. Extension du namespace existant app/admin/talent/[id]/page.tsx —
// même esthétique inline (champStyle/labelStyle/bleu/bordure déjà en
// usage dans ce fichier), aucun nouveau composant partagé introduit,
// aucun Modal. "Le Client sélectionne, l'Admin planifie" (§1.2) : cette
// zone n'apparaît que pour les CandidateSelection déjà ACTIVE (créées côté
// Client, voir app/client/talent/SelectionEtEntretiens.tsx).

const champStyle: React.CSSProperties = { padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", color: "#888", display: "block", marginBottom: 4 };

type CandidateSelection = {
  id: string;
  statut: "ACTIVE" | "RETIREE";
  shortlistEntree: { profil: { id: string; nom: string; prenom: string | null } };
};

type Interview = {
  id: string;
  statut: string;
  canal: string;
  dateHeure: string;
  dureeMinutes: number;
  lieu: string | null;
  candidateSelectionId: string;
  participants: { id: string; role: string; emailParticipant: string; statutInvitation: string; estOrganisateur: boolean }[];
};

const LABEL_STATUT_INTERVIEW: Record<string, string> = {
  PLANIFIE: "Planifié",
  CONFIRME: "Confirmé",
  TERMINE: "Terminé",
  ANNULE: "Annulé",
  ABSENT: "Absent",
};

export default function InterviewsAdmin({ demandeId }: { demandeId: string }) {
  const [selections, setSelections] = useState<CandidateSelection[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [chargement, setChargement] = useState(true);

  async function charger() {
    const [r1, r2] = await Promise.all([
      fetch(`/api/talent/demandes/${demandeId}/selections`),
      fetch(`/api/talent/demandes/${demandeId}/interviews`),
    ]);
    setChargement(false);
    if (r1.ok) setSelections((await r1.json()).selections ?? []);
    if (r2.ok) setInterviews((await r2.json()).interviews ?? []);
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeId]);

  const selectionsActives = selections.filter((s) => s.statut === "ACTIVE");

  if (chargement) return null;
  if (selectionsActives.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Entretiens</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888" }}>
        Planifiez un entretien pour un candidat sélectionné par le Client — une invitation est envoyée à chaque participant.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {interviews.map((i) => (
          <div key={i.id} style={{ border: `1px solid ${bordure}`, borderRadius: 6, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                {new Date(i.dateHeure).toLocaleString("fr-FR")} · {i.canal} · {i.dureeMinutes} min
              </p>
              <span style={{ fontSize: 11, color: bleu }}>{LABEL_STATUT_INTERVIEW[i.statut] ?? i.statut}</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: grisTexte }}>
              {i.participants.map((p) => `${p.role}${p.estOrganisateur ? " (organisateur)" : ""} : ${p.statutInvitation}`).join(" · ")}
            </p>
          </div>
        ))}
      </div>

      <FormulairePlanification demandeId={demandeId} selectionsActives={selectionsActives} onCree={charger} />
    </div>
  );
}

const CANAUX = ["VIDEO", "TELEPHONE", "PRESENTIEL", "AUTRE"] as const;

function FormulairePlanification({
  demandeId,
  selectionsActives,
  onCree,
}: {
  demandeId: string;
  selectionsActives: CandidateSelection[];
  onCree: () => void;
}) {
  const [candidateSelectionId, setCandidateSelectionId] = useState("");
  const [canal, setCanal] = useState<(typeof CANAUX)[number]>("VIDEO");
  const [dateHeure, setDateHeure] = useState("");
  const [dureeMinutes, setDureeMinutes] = useState("60");
  const [timezoneSaisie, setTimezoneSaisie] = useState("Europe/Paris");
  const [lieu, setLieu] = useState("");
  const [objectif, setObjectif] = useState("");
  const [emailCandidat, setEmailCandidat] = useState("");
  const [emailClient, setEmailClient] = useState("");
  const [emailOrganisateur, setEmailOrganisateur] = useState("");
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const selection = selectionsActives.find((s) => s.id === candidateSelectionId);

  async function creer() {
    if (!candidateSelectionId || !selection || !dateHeure || !emailCandidat || !emailClient || !emailOrganisateur) {
      setErreur("Tous les champs sont requis (candidat, dates, et les 3 emails participants).");
      return;
    }
    setErreur(null);
    setCreation(true);
    const reponse = await fetch(`/api/talent/demandes/${demandeId}/interviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateSelectionId,
        canal,
        dateHeure: new Date(dateHeure).toISOString(),
        dureeMinutes: Number(dureeMinutes),
        timezoneSaisie,
        lieu: canal === "PRESENTIEL" ? lieu || undefined : undefined,
        objectif: objectif || undefined,
        participants: [
          { role: "CANDIDAT", emailParticipant: emailCandidat, profilId: selection.shortlistEntree.profil.id },
          { role: "CLIENT", emailParticipant: emailClient },
          { role: "ADMIN_RECRUTEUR", emailParticipant: emailOrganisateur, estOrganisateur: true },
        ],
      }),
    });
    setCreation(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Planification impossible.");
      return;
    }
    setDateHeure("");
    setLieu("");
    setObjectif("");
    onCree();
  }

  return (
    <div style={{ borderTop: `1px solid ${bordure}`, paddingTop: 12 }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Planifier un entretien</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Candidat sélectionné</label>
          <select value={candidateSelectionId} onChange={(e) => setCandidateSelectionId(e.target.value)} style={champStyle}>
            <option value="">Choisir…</option>
            {selectionsActives.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortlistEntree.profil.prenom ? `${s.shortlistEntree.profil.prenom} ${s.shortlistEntree.profil.nom}` : s.shortlistEntree.profil.nom}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Canal</label>
          <select value={canal} onChange={(e) => setCanal(e.target.value as (typeof CANAUX)[number])} style={champStyle}>
            {CANAUX.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Date et heure</label>
          <input type="datetime-local" value={dateHeure} onChange={(e) => setDateHeure(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Durée (minutes)</label>
          <input type="number" min={5} max={480} value={dureeMinutes} onChange={(e) => setDureeMinutes(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Fuseau horaire (saisie)</label>
          <input value={timezoneSaisie} onChange={(e) => setTimezoneSaisie(e.target.value)} style={champStyle} />
        </div>
        {canal === "PRESENTIEL" && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Lieu</label>
            <input value={lieu} onChange={(e) => setLieu(e.target.value)} style={champStyle} />
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Objectif (optionnel)</label>
          <input value={objectif} onChange={(e) => setObjectif(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email du candidat</label>
          <input value={emailCandidat} onChange={(e) => setEmailCandidat(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email du contact Client</label>
          <input value={emailClient} onChange={(e) => setEmailClient(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email de l&apos;organisateur ATLAS</label>
          <input value={emailOrganisateur} onChange={(e) => setEmailOrganisateur(e.target.value)} style={champStyle} />
        </div>
      </div>
      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "12px 0 0" }}>{erreur}</p>}
      <button
        onClick={creer}
        disabled={creation}
        style={{ marginTop: 12, fontSize: 13, padding: "8px 16px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
      >
        {creation ? "Planification…" : "Planifier l'entretien"}
      </button>
    </div>
  );
}
