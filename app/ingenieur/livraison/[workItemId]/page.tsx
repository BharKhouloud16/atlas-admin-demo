"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// Détail "mon WorkItem" — réservé Ingénieur affecté (estIngenieurAutorise
// SurWorkItem, via GET /api/ingenieur/work-items/[workItemId], DB-01).
//
// Chaque action ci-dessous appelle EXACTEMENT une route Mission-scopée déjà
// existante et déjà testée (A25/A26), qui accepte déjà l'Ingénieur
// propriétaire de la Mission — aucune nouvelle validation, aucune nouvelle
// RBAC : le serveur reste seul juge (ex. approuver/finaliser/rejeter restent
// refusés 403 par le serveur si tentés ici, donc ces boutons ne sont jamais
// affichés sur cet écran — contrat A25 §ACTIONS_ADMIN_SEUL).
//
// IMPORTANT, affiché honnêtement : lier un Deliverable à CE WorkItem précis
// reste strictement Admin-only (A25, même pour l'Ingénieur propriétaire de
// la Mission — contrat A25 test 49). Un Deliverable créé ici est donc créé
// au niveau de la Mission et apparaît dans la section "Deliverables de la
// Mission" ci-dessous, jamais automatiquement sous "Deliverables liés à ce
// WorkItem" tant qu'un Admin ne l'a pas lié — cette distinction n'est
// jamais masquée à l'utilisateur.

const NATURES_CONTENU = ["DOCUMENT", "STRUCTURE", "OPERATION", "DECLARATIF"] as const;
// Méthodes réellement autorisées à l'Ingénieur par la matrice RBAC
// existante (lib/delivery-evidence/evidence.ts côté route — VALIDATION_ADMIN
// et INFERENCE_IA restent refusées 403, jamais proposées ici).
const METHODES_EVIDENCE_INGENIEUR = ["DECLARATION_TALENT", "MESURE_SYSTEME", "TEST_AUTOMATISE"] as const;

type Assignment = { id: string; role: string; statut: string; dateDebut: string | null; dateFin: string | null; missionAssignment: { id: string; role: string } };
type Version = { id: string; version: number; titre: string; natureContenu: string; statut: string; supersedesId: string | null; createdAt: string };
type Deliverable = { id: string; acceptanceCriteria: string | null; versions: Version[] };
type Evidence = { id: string; methode: string; confiance: string; contenu: string; createdByEmail: string };

// COMPANY ATLAS — DB-07 : Quality / DeliveryQualityGate UI (08/10/2026).
//
// Consultation STRICTEMENT en lecture — jamais de création/édition/
// finalisation ici (contrat DB-07 §18 : l'Ingénieur doit comprendre l'état
// qualité de sa Delivery, jamais approuver à la place de l'Admin). Les
// routes A27 de mutation existent et autoriseraient techniquement
// l'Ingénieur à préparer une DRAFT (contrat A27), mais cette UI ne
// l'expose pas : seule la consultation est demandée par ce lot.
type QualityGate = {
  id: string;
  criteresEvalues: string;
  acceptanceCriteriaSnapshot: string | null;
  resultat: string;
  statut: string;
  evaluatedAt: string;
  evaluatedByEmail: string;
  evaluatedByRole: string;
};
type EvidenceLink = { id: string; deliveryEvidenceId: string };

const COULEUR_STATUT_QUALITY: Record<string, string> = { DRAFT: grisTexte, FINALIZED: "#1a7f4b" };
const COULEUR_RESULTAT: Record<string, string> = { PASS: "#1a7f4b", FAIL: rouge, NOT_DETERMINABLE: "#d97706" };
type WorkItemDetail = {
  workItem: { id: string; titre: string; description: string | null; statut: string; createdAt: string };
  mission: { id: string; repere: string | null; client: { nom: string } };
  monAssignment: Assignment[];
  deliverables: Deliverable[];
  evidences: Evidence[];
};

const COULEUR_STATUT_WI: Record<string, string> = { A_FAIRE: grisTexte, EN_COURS: bleu, BLOQUE: rouge, TERMINE: "#1a7f4b", ANNULE: "#888" };
const COULEUR_STATUT_V: Record<string, string> = { DRAFT: grisTexte, REVIEW: "#d97706", APPROVED: bleu, FINALIZED: "#1a7f4b", REJECTED: rouge };

function Badge({ statut, couleurs }: { statut: string; couleurs: Record<string, string> }) {
  const couleur = couleurs[statut] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{statut}</span>;
}

export default function MonWorkItemDetailPage() {
  const params = useParams<{ workItemId: string }>();
  const workItemId = params.workItemId;

  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [deliverablesMission, setDeliverablesMission] = useState<Deliverable[]>([]);
  const [evidencesParVersion, setEvidencesParVersion] = useState<Record<string, Evidence[]>>({});
  const [qualiteParVersion, setQualiteParVersion] = useState<Record<string, QualityGate[]>>({});
  const [liensParGate, setLiensParGate] = useState<Record<string, EvidenceLink[]>>({});
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function recharger() {
    setChargement(true);
    fetch(`/api/ingenieur/work-items/${workItemId}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then(async (d: WorkItemDetail) => {
        setDetail(d);
        const dm = await fetch(`/api/missions/${d.mission.id}/deliverables`).then((r) => (r.ok ? r.json() : { deliverables: [] }));
        const livrables: Deliverable[] = dm.deliverables ?? [];
        setDeliverablesMission(livrables);
        const entrees = await Promise.all(
          livrables.flatMap((del) =>
            del.versions.map((v) =>
              fetch(`/api/missions/${d.mission.id}/deliverables/${del.id}/versions/${v.id}/evidence`)
                .then((r) => (r.ok ? r.json() : { evidences: [] }))
                .then((res) => [v.id, res.evidences ?? []] as const)
            )
          )
        );
        setEvidencesParVersion(Object.fromEntries(entrees));

        // DB-07 — consultation Quality en lecture seule (contrat A27 :
        // l'Ingénieur autorisé sur la Mission peut lire, même route que
        // l'Admin, jamais une seconde logique de lecture).
        const entreesQualite = await Promise.all(
          livrables.flatMap((del) =>
            del.versions.map((v) =>
              fetch(`/api/missions/${d.mission.id}/quality?deliverableVersionId=${v.id}`)
                .then((r) => (r.ok ? r.json() : { qualityGates: [] }))
                .then((res) => [v.id, (res.qualityGates ?? []) as QualityGate[]] as const)
            )
          )
        );
        setQualiteParVersion(Object.fromEntries(entreesQualite));

        const tousGates = entreesQualite.flatMap(([, gates]) => gates);
        const entreesLiens = await Promise.all(
          tousGates.map((g) =>
            fetch(`/api/missions/${d.mission.id}/quality/${g.id}/evidence-links`)
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
  }, [workItemId]);

  // --- Nouveau Deliverable (créé au niveau Mission) ---
  const [afficherNouveauDeliverable, setAfficherNouveauDeliverable] = useState(false);
  const [titreDeliverable, setTitreDeliverable] = useState("");
  const [natureDeliverable, setNatureDeliverable] = useState<string>("DOCUMENT");
  const [creationDeliverable, setCreationDeliverable] = useState(false);
  const [erreurDeliverable, setErreurDeliverable] = useState<string | null>(null);

  async function creerDeliverable(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setErreurDeliverable(null);
    if (!titreDeliverable.trim()) {
      setErreurDeliverable("Le titre est requis.");
      return;
    }
    setCreationDeliverable(true);
    const res = await fetch(`/api/missions/${detail.mission.id}/deliverables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre: titreDeliverable, natureContenu: natureDeliverable }),
    });
    setCreationDeliverable(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurDeliverable(err.error ?? "Erreur lors de la création.");
      return;
    }
    setTitreDeliverable("");
    setAfficherNouveauDeliverable(false);
    recharger();
  }

  async function soumettre(deliverableId: string, versionId: string) {
    if (!detail) return;
    const res = await fetch(`/api/missions/${detail.mission.id}/deliverables/${deliverableId}/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "soumettre" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de la soumission.");
      return;
    }
    recharger();
  }

  const [nouvelleVersionPour, setNouvelleVersionPour] = useState<string | null>(null);
  const [titreVersion, setTitreVersion] = useState("");
  const [natureVersion, setNatureVersion] = useState<string>("DOCUMENT");
  const [erreurVersion, setErreurVersion] = useState<string | null>(null);

  async function creerVersion(e: FormEvent, deliverableId: string) {
    e.preventDefault();
    if (!detail) return;
    setErreurVersion(null);
    if (!titreVersion.trim()) {
      setErreurVersion("Le titre est requis.");
      return;
    }
    const res = await fetch(`/api/missions/${detail.mission.id}/deliverables/${deliverableId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre: titreVersion, natureContenu: natureVersion }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurVersion(err.error ?? "Erreur lors de la création de la version.");
      return;
    }
    setTitreVersion("");
    setNouvelleVersionPour(null);
    recharger();
  }

  // --- Evidence (sur WorkItem ou sur une version de Deliverable) ---
  const [methodeEvidenceWI, setMethodeEvidenceWI] = useState<string>(METHODES_EVIDENCE_INGENIEUR[0]);
  const [contenuEvidenceWI, setContenuEvidenceWI] = useState("");
  const [erreurEvidenceWI, setErreurEvidenceWI] = useState<string | null>(null);

  async function creerEvidenceWorkItem(e: FormEvent) {
    e.preventDefault();
    setErreurEvidenceWI(null);
    if (!contenuEvidenceWI.trim()) {
      setErreurEvidenceWI("Le contenu est requis.");
      return;
    }
    const res = await fetch(`/api/missions/${detail!.mission.id}/work-items/${workItemId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methode: methodeEvidenceWI, contenu: contenuEvidenceWI }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurEvidenceWI(err.error ?? "Erreur lors de l'ajout.");
      return;
    }
    setContenuEvidenceWI("");
    recharger();
  }

  const [versionCibleEvidence, setVersionCibleEvidence] = useState<string | null>(null);
  const [methodeEvidenceV, setMethodeEvidenceV] = useState<string>(METHODES_EVIDENCE_INGENIEUR[0]);
  const [contenuEvidenceV, setContenuEvidenceV] = useState("");
  const [erreurEvidenceV, setErreurEvidenceV] = useState<string | null>(null);

  async function creerEvidenceVersion(e: FormEvent, deliverableId: string, versionId: string) {
    e.preventDefault();
    if (!detail) return;
    setErreurEvidenceV(null);
    if (!contenuEvidenceV.trim()) {
      setErreurEvidenceV("Le contenu est requis.");
      return;
    }
    const res = await fetch(`/api/missions/${detail.mission.id}/deliverables/${deliverableId}/versions/${versionId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methode: methodeEvidenceV, contenu: contenuEvidenceV }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurEvidenceV(err.error ?? "Erreur lors de l'ajout.");
      return;
    }
    setContenuEvidenceV("");
    setVersionCibleEvidence(null);
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur || !detail) return <p style={{ color: rouge }}>{erreur ?? "Tâche introuvable."}</p>;

  const idsLies = new Set(detail.deliverables.map((d) => d.id));

  return (
    <div>
      <Link href="/ingenieur/livraison" style={{ color: bleu, fontSize: 13 }}>← Mon travail</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>{detail.workItem.titre}</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 4 }}>
        Mission : {detail.mission.repere ?? detail.mission.client.nom} · Statut : <Badge statut={detail.workItem.statut} couleurs={COULEUR_STATUT_WI} />
      </p>
      {detail.workItem.description && <p style={{ fontSize: 13, color: grisTexte, marginBottom: 12 }}>{detail.workItem.description}</p>}

      {detail.monAssignment.length > 0 && (
        <p style={{ fontSize: 12, color: grisTexte, marginBottom: 20 }}>
          Mon rôle sur cette tâche : <strong>{detail.monAssignment[0].role}</strong> ({detail.monAssignment[0].statut})
        </p>
      )}

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Deliverables liés à cette tâche</h2>
        {detail.deliverables.map((d) => {
          const courante = d.versions.find((v) => !d.versions.some((autre) => autre.supersedesId === v.id));
          return (
            <p key={d.id} style={{ fontSize: 13, margin: "4px 0" }}>
              {courante?.titre ?? "(sans version)"} {courante && <Badge statut={courante.statut} couleurs={COULEUR_STATUT_V} />}
            </p>
          );
        })}
        {detail.deliverables.length === 0 && (
          <p style={{ fontSize: 13, color: "#888" }}>
            Aucun Deliverable encore lié à cette tâche précise par un Admin — voir les Deliverables de la Mission ci-dessous.
          </p>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 4 }}>Deliverables de la Mission</h2>
        <p style={{ fontSize: 12, color: grisTexte, marginBottom: 10 }}>
          Un nouveau Deliverable est créé pour la Mission ; un Admin le liera ensuite à la tâche concernée si nécessaire.
        </p>

        {deliverablesMission.map((d) => {
          const courante = d.versions.find((v) => !d.versions.some((autre) => autre.supersedesId === v.id));
          if (!courante) return null;
          return (
            <div key={d.id} style={{ padding: 10, border: `1px solid ${bordure}`, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>v{courante.version} — {courante.titre}</strong>
                <Badge statut={courante.statut} couleurs={COULEUR_STATUT_V} />
                {idsLies.has(d.id) && <span style={{ fontSize: 11, color: grisTexte }}>(lié à cette tâche)</span>}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                {courante.statut === "DRAFT" && (
                  <button onClick={() => soumettre(d.id, courante.id)} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
                    Soumettre
                  </button>
                )}
                {courante.statut !== "FINALIZED" && (
                  <button onClick={() => setNouvelleVersionPour((v) => (v === d.id ? null : d.id))} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
                    + Nouvelle version
                  </button>
                )}
              </div>

              {nouvelleVersionPour === d.id && (
                <form onSubmit={(e) => creerVersion(e, d.id)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
                  <input value={titreVersion} onChange={(e) => setTitreVersion(e.target.value)} placeholder="Titre de la nouvelle version" style={{ padding: 4, fontSize: 12, flex: 1, minWidth: 160 }} />
                  <select value={natureVersion} onChange={(e) => setNatureVersion(e.target.value)} style={{ padding: 4, fontSize: 12 }}>
                    {NATURES_CONTENU.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button type="submit" style={{ fontSize: 11, padding: "3px 8px" }}>Créer</button>
                  {erreurVersion && <p style={{ fontSize: 11, color: rouge, width: "100%", margin: 0 }}>{erreurVersion}</p>}
                </form>
              )}

              <p style={{ fontSize: 12, fontWeight: 600, color: bleuFonce, marginBottom: 4 }}>Evidence</p>
              {(evidencesParVersion[courante.id] ?? []).map((e) => (
                <p key={e.id} style={{ fontSize: 12, color: grisTexte, margin: "2px 0" }}>[{e.methode} · {e.confiance}] {e.contenu}</p>
              ))}
              {(evidencesParVersion[courante.id] ?? []).length === 0 && <p style={{ fontSize: 12, color: "#888" }}>Aucune Evidence.</p>}

              {versionCibleEvidence === courante.id ? (
                <form onSubmit={(e) => creerEvidenceVersion(e, d.id, courante.id)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 6 }}>
                  <select value={methodeEvidenceV} onChange={(e) => setMethodeEvidenceV(e.target.value)} style={{ padding: 4, fontSize: 12 }}>
                    {METHODES_EVIDENCE_INGENIEUR.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input value={contenuEvidenceV} onChange={(e) => setContenuEvidenceV(e.target.value)} placeholder="Contenu" style={{ padding: 4, fontSize: 12, flex: 1, minWidth: 160 }} />
                  <button type="submit" style={{ fontSize: 11, padding: "3px 8px" }}>Ajouter</button>
                  {erreurEvidenceV && <p style={{ fontSize: 11, color: rouge, width: "100%", margin: 0 }}>{erreurEvidenceV}</p>}
                </form>
              ) : (
                <button onClick={() => setVersionCibleEvidence(courante.id)} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer", marginTop: 6 }}>
                  + Evidence
                </button>
              )}

              <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${bordure}` }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: bleuFonce, marginBottom: 4 }}>Quality</p>
                {(qualiteParVersion[courante.id] ?? []).map((g) => (
                  <div key={g.id} style={{ border: `1px solid ${bordure}`, borderRadius: 6, padding: 8, marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                      <Badge statut={g.statut} couleurs={COULEUR_STATUT_QUALITY} />
                      <Badge statut={g.resultat} couleurs={COULEUR_RESULTAT} />
                    </div>
                    <p style={{ fontSize: 12, margin: "2px 0" }}><strong>Critères évalués :</strong> {g.criteresEvalues}</p>
                    {g.acceptanceCriteriaSnapshot && (
                      <p style={{ fontSize: 11, color: grisTexte, margin: "2px 0" }}><em>Critères d&apos;acceptation (copie figée) : {g.acceptanceCriteriaSnapshot}</em></p>
                    )}
                    <p style={{ fontSize: 10, color: grisTexte, margin: "4px 0 0" }}>
                      Évalué par {g.evaluatedByEmail} ({g.evaluatedByRole}) le {new Date(g.evaluatedAt).toLocaleString("fr-FR")}
                    </p>
                    <div style={{ marginTop: 6 }}>
                      <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 2px" }}>Evidence liée</p>
                      {(liensParGate[g.id] ?? []).map((lien) => {
                        const evidence = (evidencesParVersion[courante.id] ?? []).find((e) => e.id === lien.deliveryEvidenceId);
                        return (
                          <p key={lien.id} style={{ fontSize: 11, margin: "2px 0" }}>
                            {evidence ? `[${evidence.methode} · ${evidence.confiance}] ${evidence.contenu}` : <code>{lien.deliveryEvidenceId}</code>}
                          </p>
                        );
                      })}
                      {(liensParGate[g.id] ?? []).length === 0 && <p style={{ fontSize: 11, color: "#888", margin: "2px 0" }}>Aucune Evidence liée.</p>}
                    </div>
                  </div>
                ))}
                {(qualiteParVersion[courante.id] ?? []).length === 0 && <p style={{ fontSize: 12, color: "#888" }}>Aucune évaluation de qualité pour cette version.</p>}
              </div>
            </div>
          );
        })}
        {deliverablesMission.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucun Deliverable sur cette Mission.</p>}

        <button
          onClick={() => setAfficherNouveauDeliverable((v) => !v)}
          style={{ marginTop: 8, padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", color: bleuFonce, cursor: "pointer" }}
        >
          {afficherNouveauDeliverable ? "Annuler" : "+ Nouveau Deliverable"}
        </button>
        {afficherNouveauDeliverable && (
          <form onSubmit={creerDeliverable} style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
              Titre
              <input value={titreDeliverable} onChange={(e) => setTitreDeliverable(e.target.value)} style={{ padding: 6 }} />
            </label>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Nature du contenu
              <select value={natureDeliverable} onChange={(e) => setNatureDeliverable(e.target.value)} style={{ padding: 6 }}>
                {NATURES_CONTENU.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="submit" disabled={creationDeliverable} style={{ padding: "6px 14px", fontWeight: 600 }}>
              {creationDeliverable ? "Création…" : "Créer"}
            </button>
            {erreurDeliverable && <p style={{ fontSize: 12, color: rouge, width: "100%", margin: 0 }}>{erreurDeliverable}</p>}
          </form>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Evidence sur cette tâche</h2>
        {detail.evidences.map((e) => (
          <p key={e.id} style={{ fontSize: 13, color: grisTexte, margin: "2px 0" }}>[{e.methode} · {e.confiance}] {e.contenu}</p>
        ))}
        {detail.evidences.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune Evidence.</p>}

        <form onSubmit={creerEvidenceWorkItem} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginTop: 12 }}>
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Méthode
            <select value={methodeEvidenceWI} onChange={(e) => setMethodeEvidenceWI(e.target.value)} style={{ padding: 6 }}>
              {METHODES_EVIDENCE_INGENIEUR.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
            Contenu (assertion factuelle)
            <input value={contenuEvidenceWI} onChange={(e) => setContenuEvidenceWI(e.target.value)} style={{ padding: 6 }} />
          </label>
          <button type="submit" style={{ padding: "6px 14px", fontWeight: 600 }}>Ajouter</button>
          {erreurEvidenceWI && <p style={{ fontSize: 12, color: rouge, width: "100%", margin: 0 }}>{erreurEvidenceWI}</p>}
        </form>
      </section>
    </div>
  );
}
