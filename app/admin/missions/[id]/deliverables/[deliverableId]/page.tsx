"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// Détail Deliverable — chaîne de versions append-only (A25). Chaque
// action appelle une route A25/A26 déjà existante et déjà testée ; aucune
// transition n'est jamais décidée côté client (les boutons affichés sont
// strictement dérivés du statut de la version courante — TRANSITIONS_
// AUTORISEES reste côté serveur, qui refuse explicitement sinon).
//
// "Version courante" = la ligne dont aucune autre version ne porte
// supersedesId vers elle (contrat A25 §13, lib/deliverable/version.ts) —
// jamais une colonne/flag recalculé ici.
//
// RBAC réelle (rappel, déjà appliquée par les routes, pas par cet écran) :
// soumettre est ouvert à l'Ingénieur propriétaire de la Mission ;
// approuver/finaliser/rejeter restent strictement Admin (ACTIONS_ADMIN_
// SEUL, A25) — cette page reste Admin-only, donc tous les boutons sont
// disponibles ici sans distinction supplémentaire.

const NATURES_CONTENU = ["DOCUMENT", "STRUCTURE", "OPERATION", "DECLARATIF"] as const;
const METHODES_EVIDENCE = ["DECLARATION_TALENT", "VALIDATION_ADMIN", "VALIDATION_CLIENT", "MESURE_SYSTEME", "TEST_AUTOMATISE", "INFERENCE_IA"] as const;
const CONFIANCES_EVIDENCE = ["VERIFIE", "DECLARE", "INFERE", "INCONNU"] as const;

type Version = { id: string; version: number; titre: string; natureContenu: string; statut: string; supersedesId: string | null; createdAt: string };
type Deliverable = { id: string; acceptanceCriteria: string | null; versions: Version[] };
type Evidence = { id: string; methode: string; confiance: string; contenu: string; createdByEmail: string };

// COMPANY ATLAS — DB-07 : Quality / DeliveryQualityGate UI (08/10/2026).
//
// Consomme STRICTEMENT les routes A27 déjà existantes
// (app/api/missions/[id]/quality/**, lib/delivery-quality/quality.ts,
// inchangés) — aucun recalcul de "score qualité" ici : `resultat`
// (PASS/FAIL/NOT_DETERMINABLE) et `statut` (DRAFT/FINALIZED) sont
// affichés EXACTEMENT tels que renvoyés par le backend. Un
// DeliveryQualityGate cible TOUJOURS une DeliverableVersion précise et
// immuable (contrat A27 §6/§7/§28) — jamais WorkItem, jamais déplacé.
// Plusieurs Gates indépendants peuvent coexister sur la même version
// (contrat A27, "aucune succession") — tous affichés, jamais un seul
// "courant" sélectionné arbitrairement.
type QualityGate = {
  id: string;
  deliverableVersionId: string;
  criteresEvalues: string;
  acceptanceCriteriaSnapshot: string | null;
  resultat: string;
  statut: string;
  evaluatedAt: string;
  evaluatedByEmail: string;
  evaluatedByRole: string;
  createdAt: string;
  createdByEmail: string;
};
type EvidenceLink = { id: string; deliveryEvidenceId: string; createdAt: string; createdByEmail: string };

const COULEUR_STATUT: Record<string, string> = {
  DRAFT: grisTexte,
  REVIEW: "#d97706",
  APPROVED: bleu,
  FINALIZED: "#1a7f4b",
  REJECTED: rouge,
};

const COULEUR_STATUT_QUALITY: Record<string, string> = { DRAFT: grisTexte, FINALIZED: "#1a7f4b" };
const COULEUR_RESULTAT: Record<string, string> = { PASS: "#1a7f4b", FAIL: rouge, NOT_DETERMINABLE: "#d97706" };
const RESULTATS_QUALITY = ["PASS", "FAIL", "NOT_DETERMINABLE"] as const;

function BadgeStatut({ statut }: { statut: string }) {
  const couleur = COULEUR_STATUT[statut] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{statut}</span>;
}

function Badge({ valeur, couleurs }: { valeur: string; couleurs: Record<string, string> }) {
  const couleur = couleurs[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

export default function DeliverableDetailPage() {
  const params = useParams<{ id: string; deliverableId: string }>();
  const missionId = params.id;
  const deliverableId = params.deliverableId;

  const [deliverable, setDeliverable] = useState<Deliverable | null>(null);
  const [evidencesParVersion, setEvidencesParVersion] = useState<Record<string, Evidence[]>>({});
  const [qualiteParVersion, setQualiteParVersion] = useState<Record<string, QualityGate[]>>({});
  const [liensParGate, setLiensParGate] = useState<Record<string, EvidenceLink[]>>({});
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function recharger() {
    setChargement(true);
    fetch(`/api/missions/${missionId}/deliverables/${deliverableId}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then(async (d: Deliverable) => {
        setDeliverable(d);
        const entrees = await Promise.all(
          d.versions.map((v) =>
            fetch(`/api/missions/${missionId}/deliverables/${deliverableId}/versions/${v.id}/evidence`)
              .then((r) => (r.ok ? r.json() : { evidences: [] }))
              .then((res) => [v.id, res.evidences ?? []] as const)
          )
        );
        setEvidencesParVersion(Object.fromEntries(entrees));

        const entreesQualite = await Promise.all(
          d.versions.map((v) =>
            fetch(`/api/missions/${missionId}/quality?deliverableVersionId=${v.id}`)
              .then((r) => (r.ok ? r.json() : { qualityGates: [] }))
              .then((res) => [v.id, (res.qualityGates ?? []) as QualityGate[]] as const)
          )
        );
        setQualiteParVersion(Object.fromEntries(entreesQualite));

        const tousGates = entreesQualite.flatMap(([, gates]) => gates);
        const entreesLiens = await Promise.all(
          tousGates.map((g) =>
            fetch(`/api/missions/${missionId}/quality/${g.id}/evidence-links`)
              .then((r) => (r.ok ? r.json() : { evidenceLinks: [] }))
              .then((res) => [g.id, (res.evidenceLinks ?? []) as EvidenceLink[]] as const)
          )
        );
        setLiensParGate(Object.fromEntries(entreesLiens));

        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, deliverableId]);

  async function transitionner(versionId: string, action: string) {
    let raison: string | undefined;
    if (action === "rejeter") {
      raison = prompt("Raison du rejet (optionnel) :") ?? undefined;
    }
    const res = await fetch(`/api/missions/${missionId}/deliverables/${deliverableId}/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, raison }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de la transition.");
      return;
    }
    recharger();
  }

  // --- Nouvelle version ---
  const [afficherNouvelleVersion, setAfficherNouvelleVersion] = useState(false);
  const [titreVersion, setTitreVersion] = useState("");
  const [natureVersion, setNatureVersion] = useState<string>("DOCUMENT");
  const [creationVersion, setCreationVersion] = useState(false);
  const [erreurVersion, setErreurVersion] = useState<string | null>(null);

  async function creerVersion(e: FormEvent) {
    e.preventDefault();
    setErreurVersion(null);
    if (!titreVersion.trim()) {
      setErreurVersion("Le titre est requis.");
      return;
    }
    setCreationVersion(true);
    const res = await fetch(`/api/missions/${missionId}/deliverables/${deliverableId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre: titreVersion, natureContenu: natureVersion }),
    });
    setCreationVersion(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurVersion(err.error ?? "Erreur lors de la création de la version.");
      return;
    }
    setTitreVersion("");
    setAfficherNouvelleVersion(false);
    recharger();
  }

  // --- Evidence par version ---
  const [versionCibleEvidence, setVersionCibleEvidence] = useState<string | null>(null);
  const [methodeEvidence, setMethodeEvidence] = useState<string>("VALIDATION_ADMIN");
  const [confianceEvidence, setConfianceEvidence] = useState<string>("");
  const [contenuEvidence, setContenuEvidence] = useState("");
  const [erreurEvidence, setErreurEvidence] = useState<string | null>(null);

  async function creerEvidence(e: FormEvent, versionId: string) {
    e.preventDefault();
    setErreurEvidence(null);
    if (!contenuEvidence.trim()) {
      setErreurEvidence("Le contenu est requis.");
      return;
    }
    const res = await fetch(`/api/missions/${missionId}/deliverables/${deliverableId}/versions/${versionId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methode: methodeEvidence, confiance: confianceEvidence || undefined, contenu: contenuEvidence }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurEvidence(err.error ?? "Erreur lors de l'ajout de l'Evidence.");
      return;
    }
    setContenuEvidence("");
    setConfianceEvidence("");
    setVersionCibleEvidence(null);
    recharger();
  }

  // --- Quality (DB-07) — une évaluation DRAFT par version, créée/éditée
  // via les routes A27 existantes uniquement. Le résultat (PASS/FAIL/
  // NOT_DETERMINABLE) reste TOUJOURS une déclaration de l'évaluateur,
  // jamais un calcul frontend.
  const [versionCibleQuality, setVersionCibleQuality] = useState<string | null>(null);
  const [criteresQuality, setCriteresQuality] = useState("");
  const [resultatQuality, setResultatQuality] = useState("");
  const [erreurQuality, setErreurQuality] = useState<string | null>(null);
  const [lienCibleParGate, setLienCibleParGate] = useState<Record<string, string>>({});

  async function creerGate(e: FormEvent, versionId: string) {
    e.preventDefault();
    setErreurQuality(null);
    if (!criteresQuality.trim() || !resultatQuality) {
      setErreurQuality("Critères évalués et résultat sont requis.");
      return;
    }
    const res = await fetch(`/api/missions/${missionId}/quality`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliverableVersionId: versionId, criteresEvalues: criteresQuality, resultat: resultatQuality }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurQuality(err.error ?? "Erreur lors de la création de l'évaluation.");
      return;
    }
    setCriteresQuality("");
    setResultatQuality("");
    setVersionCibleQuality(null);
    recharger();
  }

  async function finaliserGate(gateId: string) {
    if (!confirm("Finaliser cette évaluation de qualité ? Son contenu (critères, résultat, Evidence liées) devient alors immuable.")) return;
    const res = await fetch(`/api/missions/${missionId}/quality/${gateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finaliser" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de la finalisation.");
      return;
    }
    recharger();
  }

  async function ajouterLienEvidence(gateId: string) {
    const deliveryEvidenceId = lienCibleParGate[gateId];
    if (!deliveryEvidenceId) return;
    const res = await fetch(`/api/missions/${missionId}/quality/${gateId}/evidence-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryEvidenceId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de l'ajout du lien.");
      return;
    }
    recharger();
  }

  async function retirerLienEvidence(gateId: string, linkId: string) {
    const res = await fetch(`/api/missions/${missionId}/quality/${gateId}/evidence-links/${linkId}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors du retrait du lien.");
      return;
    }
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur || !deliverable) return <p style={{ color: rouge }}>{erreur ?? "Deliverable introuvable."}</p>;

  const versionsDesc = [...deliverable.versions].sort((a, b) => b.version - a.version);
  const courante = deliverable.versions.find((v) => !deliverable.versions.some((autre) => autre.supersedesId === v.id));

  return (
    <div>
      <Link href={`/admin/missions/${missionId}/work-items`} style={{ color: bleu, fontSize: 13 }}>← WorkItems de la mission</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>{courante?.titre ?? "Deliverable"}</h1>
      {deliverable.acceptanceCriteria && (
        <p style={{ fontSize: 13, color: grisTexte, marginBottom: 16 }}><strong>Critères d&apos;acceptation :</strong> {deliverable.acceptanceCriteria}</p>
      )}

      {courante && !["FINALIZED"].includes(courante.statut) && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => setAfficherNouvelleVersion((v) => !v)}
            style={{ padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", color: bleuFonce, cursor: "pointer" }}
          >
            {afficherNouvelleVersion ? "Annuler" : "+ Nouvelle version"}
          </button>
          {afficherNouvelleVersion && (
            <form onSubmit={creerVersion} style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
                Titre
                <input value={titreVersion} onChange={(e) => setTitreVersion(e.target.value)} style={{ padding: 6 }} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                Nature du contenu
                <select value={natureVersion} onChange={(e) => setNatureVersion(e.target.value)} style={{ padding: 6 }}>
                  {NATURES_CONTENU.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button type="submit" disabled={creationVersion} style={{ padding: "6px 14px", fontWeight: 600 }}>
                {creationVersion ? "Création…" : "Créer"}
              </button>
              {erreurVersion && <p style={{ fontSize: 12, color: rouge, width: "100%", margin: 0 }}>{erreurVersion}</p>}
            </form>
          )}
        </div>
      )}

      {versionsDesc.map((v) => (
        <div key={v.id} style={{ padding: 12, border: `1px solid ${bordure}`, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>v{v.version} — {v.titre}</strong>
            <BadgeStatut statut={v.statut} />
            {v.id === courante?.id && <span style={{ fontSize: 11, color: grisTexte }}>(version courante)</span>}
          </div>
          <p style={{ fontSize: 12, color: grisTexte, marginBottom: 8 }}>Nature : {v.natureContenu}</p>

          {v.id === courante?.id && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {v.statut === "DRAFT" && <button onClick={() => transitionner(v.id, "soumettre")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Soumettre</button>}
              {v.statut === "REVIEW" && (
                <>
                  <button onClick={() => transitionner(v.id, "approuver")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Approuver</button>
                  <button onClick={() => transitionner(v.id, "rejeter")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Rejeter</button>
                </>
              )}
              {v.statut === "APPROVED" && <button onClick={() => transitionner(v.id, "finaliser")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Finaliser</button>}
            </div>
          )}

          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: bleuFonce, marginBottom: 4 }}>Evidence</p>
            {(evidencesParVersion[v.id] ?? []).map((e) => (
              <p key={e.id} style={{ fontSize: 12, color: grisTexte, margin: "2px 0" }}>
                [{e.methode} · {e.confiance}] {e.contenu} <span style={{ fontSize: 10 }}>— {e.createdByEmail}</span>
              </p>
            ))}
            {(evidencesParVersion[v.id] ?? []).length === 0 && <p style={{ fontSize: 12, color: "#888" }}>Aucune Evidence.</p>}

            {versionCibleEvidence === v.id ? (
              <form onSubmit={(e) => creerEvidence(e, v.id)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 6 }}>
                <select value={methodeEvidence} onChange={(e) => setMethodeEvidence(e.target.value)} style={{ padding: 4, fontSize: 12 }}>
                  {METHODES_EVIDENCE.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={confianceEvidence} onChange={(e) => setConfianceEvidence(e.target.value)} style={{ padding: 4, fontSize: 12 }}>
                  <option value="">(défaut)</option>
                  {CONFIANCES_EVIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={contenuEvidence} onChange={(e) => setContenuEvidence(e.target.value)} placeholder="Contenu" style={{ padding: 4, fontSize: 12, flex: 1, minWidth: 160 }} />
                <button type="submit" style={{ fontSize: 11, padding: "3px 8px" }}>Ajouter</button>
                {erreurEvidence && <p style={{ fontSize: 11, color: rouge, width: "100%", margin: 0 }}>{erreurEvidence}</p>}
              </form>
            ) : (
              <button onClick={() => setVersionCibleEvidence(v.id)} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer", marginTop: 6 }}>
                + Evidence
              </button>
            )}
          </div>

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${bordure}` }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: bleuFonce, marginBottom: 4 }}>Quality</p>
            {(qualiteParVersion[v.id] ?? []).map((g) => (
              <div key={g.id} style={{ border: `1px solid ${bordure}`, borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                  <Badge valeur={g.statut} couleurs={COULEUR_STATUT_QUALITY} />
                  <Badge valeur={g.resultat} couleurs={COULEUR_RESULTAT} />
                  {g.statut === "DRAFT" && (
                    <button onClick={() => finaliserGate(g.id)} style={{ fontSize: 10, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
                      Finaliser
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 12, margin: "2px 0" }}><strong>Critères évalués :</strong> {g.criteresEvalues}</p>
                {g.acceptanceCriteriaSnapshot && (
                  <p style={{ fontSize: 11, color: grisTexte, margin: "2px 0" }}><em>Critères d&apos;acceptation (copie figée à la création) : {g.acceptanceCriteriaSnapshot}</em></p>
                )}
                <p style={{ fontSize: 10, color: grisTexte, margin: "4px 0 0" }}>
                  Évalué par {g.evaluatedByEmail} ({g.evaluatedByRole}) le {new Date(g.evaluatedAt).toLocaleString("fr-FR")} · créé par {g.createdByEmail}
                </p>

                <div style={{ marginTop: 6 }}>
                  <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Evidence liée</p>
                  {(liensParGate[g.id] ?? []).map((lien) => {
                    const evidence = (evidencesParVersion[v.id] ?? []).find((e) => e.id === lien.deliveryEvidenceId);
                    return (
                      <div key={lien.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, margin: "2px 0" }}>
                        <span>{evidence ? `[${evidence.methode} · ${evidence.confiance}] ${evidence.contenu}` : <code>{lien.deliveryEvidenceId}</code>}</span>
                        {g.statut === "DRAFT" && (
                          <button onClick={() => retirerLienEvidence(g.id, lien.id)} style={{ fontSize: 10, padding: "1px 5px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
                            Retirer
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {(liensParGate[g.id] ?? []).length === 0 && <p style={{ fontSize: 11, color: "#888", margin: "2px 0" }}>Aucune Evidence liée.</p>}

                  {g.statut === "DRAFT" && (evidencesParVersion[v.id] ?? []).length > 0 && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <select
                        value={lienCibleParGate[g.id] ?? ""}
                        onChange={(e) => setLienCibleParGate((prev) => ({ ...prev, [g.id]: e.target.value }))}
                        style={{ fontSize: 11, padding: 3 }}
                      >
                        <option value="">Choisir une Evidence…</option>
                        {(evidencesParVersion[v.id] ?? [])
                          .filter((e) => !(liensParGate[g.id] ?? []).some((l) => l.deliveryEvidenceId === e.id))
                          .map((e) => (
                            <option key={e.id} value={e.id}>{e.contenu.slice(0, 50)}</option>
                          ))}
                      </select>
                      <button onClick={() => ajouterLienEvidence(g.id)} style={{ fontSize: 10, padding: "2px 6px" }}>Lier</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(qualiteParVersion[v.id] ?? []).length === 0 && <p style={{ fontSize: 12, color: "#888" }}>Aucune évaluation de qualité pour cette version.</p>}

            {versionCibleQuality === v.id ? (
              <form onSubmit={(e) => creerGate(e, v.id)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 6 }}>
                <select value={resultatQuality} onChange={(e) => setResultatQuality(e.target.value)} style={{ padding: 4, fontSize: 12 }}>
                  <option value="">Résultat…</option>
                  {RESULTATS_QUALITY.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input value={criteresQuality} onChange={(e) => setCriteresQuality(e.target.value)} placeholder="Critères réellement évalués" style={{ padding: 4, fontSize: 12, flex: 1, minWidth: 200 }} />
                <button type="submit" style={{ fontSize: 11, padding: "3px 8px" }}>Créer</button>
                {erreurQuality && <p style={{ fontSize: 11, color: rouge, width: "100%", margin: 0 }}>{erreurQuality}</p>}
              </form>
            ) : (
              <button onClick={() => setVersionCibleQuality(v.id)} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer", marginTop: 6 }}>
                + Évaluation qualité
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
