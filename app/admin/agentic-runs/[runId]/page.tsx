"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge, vert, orange } from "@/lib/theme";

// COMPANY ATLAS — DB-06 : Agentic Runtime UI (08/10/2026).
//
// Détail d'un AgenticRun — consomme EXCLUSIVEMENT les routes A32/B22 déjà
// existantes, jamais modifiées par ce lot :
//   GET    /api/agentic-runs/[runId]                          (lecture)
//   GET    /api/agentic-runs/[runId]/steps                    (lecture)
//   POST   /api/agentic-runs/[runId]/start|pause|resume|stop  (transitions déjà autorisées)
//   GET    /api/control-plane/authorization-requests?correlationId=... (lecture)
//   PATCH  /api/control-plane/authorization-requests/[id]/approve      (décision humaine ALLOW/DENY)
//   GET    /api/control-plane/emergency-stops?actif=true      (lecture)
//   POST   /api/control-plane/emergency-stops                 (activation)
//   PATCH  /api/control-plane/emergency-stops/[id]/lift        (levée)
//   GET    /api/security/agents                                (résolution du nom de l'Agent, cosmétique)
//
// AUCUNE mutation n'est jamais simulée côté frontend : chaque bouton
// appelle une de ces API, recharge depuis le serveur, et n'affiche jamais
// un état optimiste. missionId/needVersionId/solutionDecisionId sont
// affichés EXACTEMENT tels que retournés — jamais recalculés, jamais
// reconstruits depuis la Mission (contrat DB-06 §6).

type Run = {
  id: string;
  loopType: string;
  loopVersion: number;
  agentIdentityId: string;
  declaredAction: string;
  declaredScope: string;
  goal: string;
  missionId: string | null;
  needVersionId: string | null;
  solutionDecisionId: string | null;
  statut: string;
  maxIterations: number;
  iterationCount: number;
  currentAuthorizationRequestId: string | null;
  stopReason: string | null;
  resultSummary: string | null;
  errorDetail: string | null;
  correlationId: string;
  createdAt: string;
  createdByEmail: string;
  createdByRole: string;
  startedAt: string | null;
  pausedAt: string | null;
  resumedAt: string | null;
  completedAt: string | null;
};

type ActionExecutionVue = {
  id: string;
  toolId: string;
  statut: string;
  resultat: unknown;
  erreur: string | null;
  createdAt: string;
  completedAt: string | null;
};

type StepVue = {
  id: string;
  stepIndex: number;
  stepType: string;
  observation: string;
  proposal: string | null;
  actionClass: string | null;
  authorizationRequestId: string | null;
  toolId: string | null;
  verificationResult: string | null;
  verificationPassed: boolean | null;
  statut: string;
  errorDetail: string | null;
  createdAt: string;
  completedAt: string | null;
  actionExecution: ActionExecutionVue | null;
};

type AuthorizationRequestVue = {
  id: string;
  action: string;
  actionClass: string;
  scope: string;
  resource: string | null;
  objective: string;
  reason: string;
  riskLevel: string | null;
  riskJustification: string | null;
  amount: number | null;
  requestedAutonomyLevel: string;
  status: string;
  decision: string | null;
  decisionReason: string | null;
  decidedBy: string | null;
  expiresAt: string;
  requestedAt: string;
};

type EmergencyStopVue = {
  id: string;
  scope: string;
  targetId: string | null;
  reason: string;
  activatedBy: string;
  activatedAt: string;
  liftedBy: string | null;
  liftedAt: string | null;
};

const COULEUR_STATUT: Record<string, string> = {
  DRAFT: grisTexte, READY: bleu, RUNNING: bleu, WAITING_APPROVAL: orange, PAUSED: orange,
  SUCCEEDED: vert, FAILED: rouge, STOPPED: rouge, ESCALATED: rouge,
};
const COULEUR_STEP: Record<string, string> = { PENDING: grisTexte, SUCCEEDED: vert, FAILED: rouge };

function Badge({ valeur, couleurs = COULEUR_STATUT }: { valeur: string; couleurs?: Record<string, string> }) {
  const couleur = couleurs[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>{valeur}</span>;
}

const champStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${bordure}`, fontSize: 13, fontFamily: "inherit" };

export default function AgenticRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;

  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<StepVue[]>([]);
  const [nomAgent, setNomAgent] = useState<string | null>(null);
  const [demandeApprobation, setDemandeApprobation] = useState<AuthorizationRequestVue | null>(null);
  const [emergencyStops, setEmergencyStops] = useState<EmergencyStopVue[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);

  const [motifDecision, setMotifDecision] = useState("");
  const [motifEmergencyStop, setMotifEmergencyStop] = useState("");
  const [scopeEmergencyStop, setScopeEmergencyStop] = useState<"GLOBAL" | "AGENT">("AGENT");

  function recharger() {
    setChargement(true);
    fetch(`/api/agentic-runs/${runId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Erreur ${r.status}`);
        return r.json();
      })
      .then(async (runData: Run) => {
        setRun(runData);
        setErreur(null);

        const [stepsRes, agentsRes, stopsRes] = await Promise.all([
          fetch(`/api/agentic-runs/${runId}/steps`).then((r) => (r.ok ? r.json() : { steps: [] })),
          fetch("/api/security/agents").then((r) => (r.ok ? r.json() : { agents: [] })),
          fetch("/api/control-plane/emergency-stops?actif=true").then((r) => (r.ok ? r.json() : { emergencyStops: [] })),
        ]);
        setSteps(stepsRes.steps ?? []);
        const agent = (agentsRes.agents ?? []).find((a: { id: string }) => a.id === runData.agentIdentityId);
        setNomAgent(agent?.agent ?? null);
        setEmergencyStops(stopsRes.emergencyStops ?? []);

        if (runData.statut === "WAITING_APPROVAL" && runData.currentAuthorizationRequestId) {
          const demandesRes = await fetch(`/api/control-plane/authorization-requests?correlationId=${encodeURIComponent(runData.correlationId)}`).then((r) => (r.ok ? r.json() : { authorizationRequests: [] }));
          const demande = (demandesRes.authorizationRequests ?? []).find((d: { id: string }) => d.id === runData.currentAuthorizationRequestId);
          setDemandeApprobation(demande ?? null);
        } else {
          setDemandeApprobation(null);
        }
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  async function appeler(url: string, options: RequestInit, confirmation?: string) {
    if (confirmation && !confirm(confirmation)) return;
    setErreurAction(null);
    setActionEnCours(true);
    const res = await fetch(url, options);
    setActionEnCours(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurAction(err.error ?? "L'action a échoué.");
      return;
    }
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur || !run) return <p style={{ color: rouge }}>{erreur ?? "Run introuvable."}</p>;

  const emergencyStopActif = emergencyStops.find((s) => s.scope === "GLOBAL" || (s.scope === "AGENT" && s.targetId === run.agentIdentityId)) ?? null;
  const estTerminal = ["SUCCEEDED", "FAILED", "STOPPED", "ESCALATED"].includes(run.statut);

  return (
    <div>
      <Link href="/admin/agentic-runs" style={{ color: bleu, fontSize: 13 }}>← Tous les Runs</Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginTop: 8 }}>
        <div>
          <h1 style={{ margin: 0, color: bleuFonce }}>{run.loopType} — {run.declaredAction}/{run.declaredScope}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: grisTexte }}>{run.goal}</p>
        </div>
        <Badge valeur={run.statut} />
      </div>

      {erreurAction && <p style={{ color: rouge, fontSize: 13 }}>{erreurAction}</p>}

      {/* ---- APPROBATION HUMAINE REQUISE (contrat DB-06 §10, point critique) ---- */}
      {run.statut === "WAITING_APPROVAL" && (
        <section style={{ border: `2px solid ${orange}`, borderRadius: 8, padding: 14, marginBottom: 20, background: "#fff8f0" }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: orange }}>⚠ APPROBATION ADMIN REQUISE</p>
          {!demandeApprobation && <p style={{ fontSize: 13, color: grisTexte }}>Chargement de la demande d&apos;autorisation…</p>}
          {demandeApprobation && (
            <>
              <table style={{ fontSize: 13, marginTop: 8 }}>
                <tbody>
                  <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Action proposée</td><td>{demandeApprobation.action}/{demandeApprobation.scope} (classe {demandeApprobation.actionClass})</td></tr>
                  <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Objectif</td><td>{demandeApprobation.objective}</td></tr>
                  <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Justification</td><td>{demandeApprobation.reason}</td></tr>
                  {demandeApprobation.riskLevel && <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Niveau de risque</td><td>{demandeApprobation.riskLevel} — {demandeApprobation.riskJustification}</td></tr>}
                  {demandeApprobation.amount != null && <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Montant</td><td>{demandeApprobation.amount}</td></tr>}
                  <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Niveau d&apos;autonomie demandé</td><td>{demandeApprobation.requestedAutonomyLevel}</td></tr>
                  <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Expire le</td><td>{new Date(demandeApprobation.expiresAt).toLocaleString("fr-FR")}</td></tr>
                  <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Statut de la demande</td><td>{demandeApprobation.status}</td></tr>
                </tbody>
              </table>

              {demandeApprobation.status === "PENDING" && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: grisTexte, display: "block", marginBottom: 4 }}>Motif de la décision (obligatoire)</label>
                  <textarea value={motifDecision} onChange={(e) => setMotifDecision(e.target.value)} rows={2} style={champStyle} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      disabled={actionEnCours || motifDecision.trim().length === 0}
                      onClick={() =>
                        appeler(`/api/control-plane/authorization-requests/${demandeApprobation.id}/approve`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ decision: "ALLOW", decisionReason: motifDecision.trim() }),
                        })
                      }
                      style={{ background: vert, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    >
                      Approuver (ALLOW)
                    </button>
                    <button
                      disabled={actionEnCours || motifDecision.trim().length === 0}
                      onClick={() =>
                        appeler(`/api/control-plane/authorization-requests/${demandeApprobation.id}/approve`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ decision: "DENY", decisionReason: motifDecision.trim() }),
                        })
                      }
                      style={{ background: "#fff", color: rouge, border: `1px solid ${rouge}`, borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    >
                      Refuser (DENY)
                    </button>
                  </div>
                </div>
              )}

              {demandeApprobation.status !== "PENDING" && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 13, margin: 0 }}>
                    Décision déjà enregistrée : <strong>{demandeApprobation.decision}</strong> — {demandeApprobation.decisionReason} (par {demandeApprobation.decidedBy})
                  </p>
                  <p style={{ fontSize: 12, color: grisTexte, margin: "6px 0 0" }}>
                    Le Run reste en WAITING_APPROVAL jusqu&apos;à ce qu&apos;il soit explicitement repris — cette reprise relit la décision déjà enregistrée, elle ne décide jamais elle-même.
                  </p>
                  <button
                    disabled={actionEnCours}
                    onClick={() => appeler(`/api/agentic-runs/${run.id}/resume`, { method: "POST" })}
                    style={{ marginTop: 8, background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Reprendre le Run
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ---- EMERGENCY STOP (contrat DB-06 §11) ---- */}
      <section style={{ border: `1px solid ${emergencyStopActif ? rouge : bordure}`, borderRadius: 8, padding: 12, marginBottom: 20, background: emergencyStopActif ? "#fdecea" : undefined }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Emergency Stop</h2>
        {emergencyStopActif ? (
          <>
            <p style={{ fontSize: 13, color: rouge, fontWeight: 600, margin: "8px 0 0" }}>⛔ Actif — scope {emergencyStopActif.scope}{emergencyStopActif.targetId ? ` (${emergencyStopActif.targetId})` : ""}</p>
            <p style={{ fontSize: 12, color: grisTexte, margin: "4px 0 0" }}>
              Motif : {emergencyStopActif.reason} — activé par {emergencyStopActif.activatedBy} le {new Date(emergencyStopActif.activatedAt).toLocaleString("fr-FR")}
            </p>
            <button
              disabled={actionEnCours}
              onClick={() =>
                appeler(
                  `/api/control-plane/emergency-stops/${emergencyStopActif.id}/lift`,
                  { method: "PATCH" },
                  "Lever cet Emergency Stop ? Les Runs concernés pourront reprendre leur exécution."
                )
              }
              style={{ marginTop: 8, background: "#fff", color: rouge, border: `1px solid ${rouge}`, borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Lever l&apos;Emergency Stop
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: grisTexte, margin: "8px 0 0" }}>Aucun Emergency Stop actif pour cet agent.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
              <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
                Scope
                <select value={scopeEmergencyStop} onChange={(e) => setScopeEmergencyStop(e.target.value as "GLOBAL" | "AGENT")} style={{ padding: 6 }}>
                  <option value="AGENT">AGENT (cet agent uniquement)</option>
                  <option value="GLOBAL">GLOBAL (tout le Runtime)</option>
                </select>
              </label>
              <input
                placeholder="Motif (obligatoire)"
                value={motifEmergencyStop}
                onChange={(e) => setMotifEmergencyStop(e.target.value)}
                style={{ ...champStyle, width: 280 }}
              />
              <button
                disabled={actionEnCours || motifEmergencyStop.trim().length === 0}
                onClick={() =>
                  appeler(
                    "/api/control-plane/emergency-stops",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        scope: scopeEmergencyStop,
                        targetId: scopeEmergencyStop === "AGENT" ? run.agentIdentityId : undefined,
                        reason: motifEmergencyStop.trim(),
                      }),
                    },
                    `Déclencher un Emergency Stop ${scopeEmergencyStop} ? Ceci bloque immédiatement ${scopeEmergencyStop === "GLOBAL" ? "tout le Runtime" : "cet agent"}.`
                  )
                }
                style={{ background: rouge, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Déclencher un Emergency Stop
              </button>
            </div>
          </>
        )}
      </section>

      {/* ---- ÉTATS (PAUSED / ESCALATED / FAILED / SUCCEEDED) ---- */}
      {run.statut === "PAUSED" && (
        <section style={{ border: `1px solid ${orange}`, borderRadius: 8, padding: 12, marginBottom: 20, background: "#fff8f0" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: orange }}>PAUSED</p>
          <p style={{ fontSize: 13, margin: "4px 0 0" }}>Mis en pause manuellement le {run.pausedAt ? new Date(run.pausedAt).toLocaleString("fr-FR") : "—"} — aucune itération en cours.</p>
        </section>
      )}
      {run.statut === "ESCALATED" && (
        <section style={{ border: `1px solid ${rouge}`, borderRadius: 8, padding: 12, marginBottom: 20, background: "#fdecea" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: rouge }}>ESCALATED</p>
          <p style={{ fontSize: 13, margin: "4px 0 0" }}>Raison : {run.stopReason}{run.errorDetail ? ` — ${run.errorDetail}` : ""}</p>
        </section>
      )}
      {run.statut === "FAILED" && (
        <section style={{ border: `1px solid ${rouge}`, borderRadius: 8, padding: 12, marginBottom: 20, background: "#fdecea" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: rouge }}>FAILED</p>
          <p style={{ fontSize: 13, margin: "4px 0 0" }}>Raison : {run.stopReason}{run.errorDetail ? ` — ${run.errorDetail}` : ""}</p>
        </section>
      )}
      {run.statut === "SUCCEEDED" && (
        <section style={{ border: `1px solid ${vert}`, borderRadius: 8, padding: 12, marginBottom: 20, background: "#f2faf5" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: vert }}>Run terminé avec succès</p>
          <p style={{ fontSize: 13, margin: "4px 0 0" }}>Raison : {run.stopReason}{run.resultSummary ? ` — ${run.resultSummary}` : ""}</p>
          <p style={{ fontSize: 11, color: grisTexte, margin: "4px 0 0" }}>Le succès du Runtime ne constitue jamais, en lui-même, un succès métier de la Mission.</p>
        </section>
      )}

      {/* ---- ACTIONS DE CYCLE DE VIE (déjà autorisées par le Runtime) ---- */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {run.statut === "DRAFT" && (
          <button disabled={actionEnCours} onClick={() => appeler(`/api/agentic-runs/${run.id}/start`, { method: "POST" })} style={{ background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Démarrer
          </button>
        )}
        {run.statut === "RUNNING" && (
          <button disabled={actionEnCours} onClick={() => appeler(`/api/agentic-runs/${run.id}/pause`, { method: "POST" })} style={{ background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
            Mettre en pause
          </button>
        )}
        {run.statut === "PAUSED" && (
          <button disabled={actionEnCours} onClick={() => appeler(`/api/agentic-runs/${run.id}/resume`, { method: "POST" })} style={{ background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Reprendre
          </button>
        )}
        {!estTerminal && (
          <button
            disabled={actionEnCours}
            onClick={() => appeler(`/api/agentic-runs/${run.id}/stop`, { method: "POST" }, "Arrêter ce Run de façon définitive (HUMAN_STOP) ?")}
            style={{ background: "#fff", color: rouge, border: `1px solid ${rouge}`, borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Arrêter le Run
          </button>
        )}
      </div>

      {/* ---- IDENTITÉ ---- */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Identité</h2>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Run ID</td><td><code style={{ fontSize: 12 }}>{run.id}</code></td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Agent</td><td>{nomAgent ?? <code style={{ fontSize: 12 }}>{run.agentIdentityId}</code>}{nomAgent && <> (<code style={{ fontSize: 11 }}>{run.agentIdentityId}</code>)</>}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Loop</td><td>{run.loopType} v{run.loopVersion}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Itérations</td><td>{run.iterationCount} / {run.maxIterations}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Créé le</td><td>{new Date(run.createdAt).toLocaleString("fr-FR")}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>Créé par</td><td>{run.createdByEmail} ({run.createdByRole})</td></tr>
          </tbody>
        </table>
      </section>

      {/* ---- CONTEXTE DÉCISIONNEL (pins exacts, jamais recalculés) ---- */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Contexte décisionnel</h2>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>missionId</td><td>{run.missionId ? <code style={{ fontSize: 12 }}>{run.missionId}</code> : <span style={{ color: "#888" }}>aucune</span>}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>needVersionId</td><td>{run.needVersionId ? <code style={{ fontSize: 12 }}>{run.needVersionId}</code> : <span style={{ color: "#888" }}>—</span>}</td></tr>
            <tr><td style={{ color: grisTexte, paddingRight: 16 }}>solutionDecisionId</td><td>{run.solutionDecisionId ? <code style={{ fontSize: 12 }}>{run.solutionDecisionId}</code> : <span style={{ color: "#888" }}>—</span>}</td></tr>
          </tbody>
        </table>
      </section>

      {/* ---- STEPS (ordre réel, jamais réordonné) ---- */}
      <section>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Steps</h2>
        {steps.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune Step pour ce Run.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.map((s) => (
            <div key={s.id} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Step {s.stepIndex} — {s.stepType}</p>
                <Badge valeur={s.statut} couleurs={COULEUR_STEP} />
              </div>
              <p style={{ fontSize: 11, color: grisTexte, margin: "4px 0 0" }}>
                Créée le {new Date(s.createdAt).toLocaleString("fr-FR")}{s.completedAt ? ` · terminée le ${new Date(s.completedAt).toLocaleString("fr-FR")}` : ""}
              </p>

              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Observation</p>
                <p style={{ fontSize: 13, margin: 0 }}>{s.observation || <span style={{ color: "#888" }}>—</span>}</p>
              </div>

              {s.stepType === "PROPOSE_AND_ACT" && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Proposition {s.actionClass ? `(classe ${s.actionClass})` : ""}</p>
                  <p style={{ fontSize: 13, margin: 0 }}>{s.proposal || <span style={{ color: "#888" }}>Aucune proposition enregistrée — jamais une action supposée.</span>}</p>
                </div>
              )}

              {s.authorizationRequestId && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Approbation</p>
                  <p style={{ fontSize: 12, margin: 0 }}>AuthorizationRequest <code>{s.authorizationRequestId}</code></p>
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Exécution</p>
                {!s.actionExecution && <p style={{ fontSize: 13, margin: 0, color: "#888" }}>Aucune ActionExecution — cette proposition n&apos;a jamais été exécutée.</p>}
                {s.actionExecution && (
                  <div style={{ fontSize: 13 }}>
                    <p style={{ margin: 0 }}>
                      Tool <code style={{ fontSize: 12 }}>{s.actionExecution.toolId}</code> — <Badge valeur={s.actionExecution.statut} couleurs={COULEUR_STEP} />
                    </p>
                    {s.actionExecution.resultat != null && (
                      <pre style={{ fontSize: 11, background: "#f6f7fb", padding: 8, borderRadius: 6, overflowX: "auto", margin: "4px 0 0" }}>{JSON.stringify(s.actionExecution.resultat, null, 2)}</pre>
                    )}
                    {s.actionExecution.erreur && <p style={{ color: rouge, fontSize: 12, margin: "4px 0 0" }}>{s.actionExecution.erreur}</p>}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Résultat</p>
                {s.verificationResult && <p style={{ fontSize: 13, margin: 0 }}>{s.verificationResult} ({s.verificationPassed ? "vérification réussie" : "vérification échouée"})</p>}
                {!s.verificationResult && <p style={{ fontSize: 13, margin: 0, color: "#888" }}>—</p>}
                {s.errorDetail && <p style={{ color: rouge, fontSize: 12, margin: "4px 0 0" }}>{s.errorDetail}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
