"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-04 : Learning UI (08/10/2026).
//
// Détail Learning — consomme GET .../learning/[learningId] (lecture,
// ADMIN+INGENIEUR autorisé) et PATCH .../learning/[learningId] (actions
// "valider"/"marquer_obsolete", strictement ADMIN — déjà vérifié par la
// route elle-même, cette page se contente d'afficher les boutons
// correspondant aux transitions réellement possibles et de refléter un
// refus serveur, jamais de supposer un succès avant la réponse).
//
// RÈGLE CRITIQUE (contrat DB-04 §11/§16) : la source affichée ci-dessous
// est EXACTEMENT le pointeur structuré réellement présent sur la ligne
// (une seule des 7 colonnes sourceXxxId, jamais plus) — aucune
// reconstruction, aucun "sourceType"/"sourceId" générique inventé. La
// provenance (OBSERVED/DECLARED/VERIFIED/INFERRED) reste affichée telle
// quelle même après validation — valider ne change jamais ce champ
// (contrat A30 §3.2/§6), seulement `statut`.
//
// Aucune édition de contenu (title/statement/type/provenance/confidence/
// scope/source) n'est jamais proposée ici — A30 est append-only sur le
// contenu (contrat §13) ; une correction passe exclusivement par une
// nouvelle ligne via POST .../learning avec supersedesId, hors scope de
// cette UI de consultation+validation (DB-04 §14 : "consultation
// uniquement" côté supersession, jamais une mutation parallèle créée ici).

type Learning = {
  id: string;
  missionId: string;
  title: string;
  statement: string;
  type: string;
  provenance: string;
  confidence: string;
  scope: string;
  statut: string;
  validatedAt: string | null;
  validatedByEmail: string | null;
  applicabilite: string;
  obsoleteAt: string | null;
  obsoleteByEmail: string | null;
  supersedesId: string | null;
  correlationId: string | null;
  createdAt: string;
  createdByEmail: string;
  createdByRole: string;
  sourceWorkItemId: string | null;
  sourceDeliverableId: string | null;
  sourceDeliverableVersionId: string | null;
  sourceDeliveryEvidenceId: string | null;
  sourceDeliveryQualityGateId: string | null;
  sourceOutcomeAssessmentId: string | null;
  sourceFinancialResultId: string | null;
};

const COULEUR_STATUT: Record<string, string> = { PROPOSE: "#d97706", VALIDE: "#1a7f4b" };
const COULEUR_APPLICABILITE: Record<string, string> = { ACTIVE: "#1a7f4b", OBSOLETE: "#888" };
const COULEUR_CONFIDENCE: Record<string, string> = { LOW: grisTexte, MEDIUM: "#d97706", HIGH: bleu };

function Badge({ valeur, couleurs }: { valeur: string; couleurs: Record<string, string> }) {
  const couleur = couleurs[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

// Un seul pointeur source précis au maximum (contrat A30 §7/§8) — la
// première colonne non-nulle trouvée est LA source, jamais plusieurs.
const CHAMPS_SOURCE: { champ: keyof Learning; label: string; lienWorkItem?: boolean; lienDeliverable?: boolean }[] = [
  { champ: "sourceWorkItemId", label: "WorkItem", lienWorkItem: true },
  { champ: "sourceDeliverableId", label: "Deliverable", lienDeliverable: true },
  { champ: "sourceDeliverableVersionId", label: "DeliverableVersion" },
  { champ: "sourceDeliveryEvidenceId", label: "DeliveryEvidence" },
  { champ: "sourceDeliveryQualityGateId", label: "DeliveryQualityGate" },
  { champ: "sourceOutcomeAssessmentId", label: "OutcomeAssessment" },
  { champ: "sourceFinancialResultId", label: "FinancialResult" },
];

export default function LearningDetailPage() {
  const params = useParams<{ id: string; learningId: string }>();
  const missionId = params.id;
  const learningId = params.learningId;

  const [learning, setLearning] = useState<Learning | null>(null);
  const [estAdmin, setEstAdmin] = useState(false);
  const [supersedePar, setSupersedePar] = useState<{ id: string; title: string } | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);

  function recharger() {
    setChargement(true);
    Promise.all([
      fetch(`/api/missions/${missionId}/learning/${learningId}`).then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
      fetch(`/api/missions/${missionId}/learning`).then((r) => (r.ok ? r.json() : { learnings: [] })),
      fetch("/api/clients").then((r) => r.ok),
    ])
      .then(([detailRes, listeRes, isAdmin]) => {
        if (!detailRes.ok) throw new Error(detailRes.d?.error ?? "Erreur de chargement.");
        setLearning(detailRes.d);
        setEstAdmin(isAdmin);
        const successeur = (listeRes.learnings ?? []).find((l: { supersedesId: string | null }) => l.supersedesId === learningId);
        setSupersedePar(successeur ? { id: successeur.id, title: successeur.title } : null);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, learningId]);

  async function valider() {
    setErreurAction(null);
    const res = await fetch(`/api/missions/${missionId}/learning/${learningId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "valider" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurAction(err.error ?? "Erreur lors de la validation.");
      return;
    }
    recharger();
  }

  async function marquerObsolete() {
    if (!confirm("Marquer ce Learning comme obsolète ? Cette transition est irréversible (une réactivation nécessiterait un nouveau Learning).")) return;
    setErreurAction(null);
    const res = await fetch(`/api/missions/${missionId}/learning/${learningId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "marquer_obsolete" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurAction(err.error ?? "Erreur lors du marquage obsolète.");
      return;
    }
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur || !learning) return <p style={{ color: rouge }}>{erreur ?? "Learning introuvable."}</p>;

  const source = CHAMPS_SOURCE.find((c) => learning[c.champ]);

  return (
    <div>
      <Link href={`/admin/missions/${missionId}/learning`} style={{ color: bleu, fontSize: 13 }}>← Learnings de la mission</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>{learning.title}</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Badge valeur={learning.statut} couleurs={COULEUR_STATUT} />
        <Badge valeur={learning.applicabilite} couleurs={COULEUR_APPLICABILITE} />
      </div>

      {estAdmin && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {learning.statut === "PROPOSE" && (
            <button onClick={valider} style={{ fontSize: 12, padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
              Valider
            </button>
          )}
          {learning.applicabilite === "ACTIVE" && (
            <button onClick={marquerObsolete} style={{ fontSize: 12, padding: "6px 14px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
              Marquer obsolète
            </button>
          )}
          {erreurAction && <p style={{ fontSize: 12, color: rouge, margin: 0 }}>{erreurAction}</p>}
        </div>
      )}

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Contenu</h2>
        <p style={{ fontSize: 13, lineHeight: 1.5 }}>{learning.statement}</p>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Classification</h2>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Type</td><td>{learning.type}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Provenance</td><td>{learning.provenance}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Confidence</td><td><Badge valeur={learning.confidence} couleurs={COULEUR_CONFIDENCE} /></td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Scope</td><td>{learning.scope}</td></tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Statuts</h2>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Validation</td><td><Badge valeur={learning.statut} couleurs={COULEUR_STATUT} /></td></tr>
            {learning.validatedAt && <tr><td style={{ color: grisTexte, paddingRight: 16 }}></td><td style={{ fontSize: 12, color: grisTexte }}>Validé le {new Date(learning.validatedAt).toLocaleString("fr-FR")} par {learning.validatedByEmail}</td></tr>}
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Applicabilité</td><td><Badge valeur={learning.applicabilite} couleurs={COULEUR_APPLICABILITE} /></td></tr>
            {learning.obsoleteAt && <tr><td style={{ color: grisTexte, paddingRight: 16 }}></td><td style={{ fontSize: 12, color: grisTexte }}>Marqué obsolète le {new Date(learning.obsoleteAt).toLocaleString("fr-FR")} par {learning.obsoleteByEmail}</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Source</h2>
        {source ? (
          <p style={{ fontSize: 13 }}>
            {source.label} — <code style={{ fontSize: 12 }}>{learning[source.champ] as string}</code>
            {source.lienWorkItem && (
              <> (<Link href={`/admin/missions/${missionId}/work-items/${learning.sourceWorkItemId}`} style={{ color: bleu }}>ouvrir</Link>)</>
            )}
            {source.lienDeliverable && (
              <> (<Link href={`/admin/missions/${missionId}/deliverables/${learning.sourceDeliverableId}`} style={{ color: bleu }}>ouvrir</Link>)</>
            )}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: "#888" }}>Aucune source précise (Learning général sur la mission).</p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Contexte</h2>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Mission</td><td><code style={{ fontSize: 12 }}>{learning.missionId}</code></td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Créé par</td><td style={{ fontSize: 12 }}>{learning.createdByEmail} ({learning.createdByRole}) · {new Date(learning.createdAt).toLocaleString("fr-FR")}</td></tr>
            {learning.correlationId && <tr><td style={{ color: grisTexte, paddingRight: 16 }}>correlationId</td><td><code style={{ fontSize: 12 }}>{learning.correlationId}</code></td></tr>}
            {learning.supersedesId && (
              <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Supersède</td><td><Link href={`/admin/missions/${missionId}/learning/${learning.supersedesId}`} style={{ color: bleu, fontSize: 12 }}>{learning.supersedesId}</Link></td></tr>
            )}
            {supersedePar && (
              <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Supersédé par</td><td><Link href={`/admin/missions/${missionId}/learning/${supersedePar.id}`} style={{ color: bleu, fontSize: 12 }}>{supersedePar.title}</Link></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
