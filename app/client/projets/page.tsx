"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bleuFonce, bordure, grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";
import { ETAPES_PROJET, LIBELLE_STATUT_PROJET, type StatutProjetValeur } from "@/lib/projet/regles";

// LOT 6 (28/10/2026) — PROJETS : confier à ATLAS un projet complet avec un
// résultat attendu, pas seulement chercher un profil. Parcours : décrire le
// projet -> qualification par ATLAS (informations manquantes signalées) ->
// propositions (indicatives puis vérifiées), comparées par version ->
// intérêt, précisions, acceptation -> engagement confirmé par ATLAS ->
// missions et suivi. Une proposition indicative n'engage personne : aucune
// équipe, aucun tarif ferme ni aucune date garantie n'y est affirmé.

type Proposition = {
  id: string;
  version: number;
  niveau: "INDICATIVE" | "VERIFIEE";
  statut: "PUBLIEE" | "ACCEPTEE" | "DECLINEE" | "REMPLACEE";
  approche: string;
  perimetre: string;
  equipe: { role: string; nombre: number; competences: string[] }[];
  etapes: { nom: string; livrables: string[]; dureeEstimee: string | null }[];
  delaiEstime: string | null;
  budgetEstimeMin: number | null;
  budgetEstimeMax: number | null;
  devise: string;
  hypotheses: string[];
  exclusions: string[];
  publieeLe: string | null;
};

type Projet = {
  id: string;
  type: "DELIVERY" | "SERVICE_ATLAS_OS";
  titre: string;
  objectif: string;
  resultatAttendu: string;
  perimetre: string | null;
  contraintes: string | null;
  exigencesTechniques: string | null;
  calendrierSouhaite: string | null;
  budgetIndicatif: string | null;
  statut: StatutProjetValeur;
  createdAt: string;
  manquants: { requises: string[]; utiles: string[] };
  competencesIdentifiees: string[];
  propositions: Proposition[];
  evenements: { id: string; type: string; detail: string | null; auteur: string; le: string; statutTraitement: "ENVOYEE" | "PRISE_EN_CHARGE" | "CLOTUREE" | null }[];
  missions: { id: string; repere: string | null; statut: string }[];
};

const LIBELLE_EVENEMENT: Record<string, string> = {
  CREATION: "Projet confié à ATLAS",
  COMPLEMENT_CLIENT: "Projet complété",
  STATUT_QUALIFIE: "Projet qualifié par ATLAS",
  PROPOSITION_INDICATIVE_PUBLIEE: "Proposition indicative publiée",
  PROPOSITION_VERIFIEE_PUBLIEE: "Proposition vérifiée publiée",
  INTERET_MANIFESTE: "Intérêt manifesté pour la proposition",
  DEMANDE_PRECISION: "Demande de précision ou d'ajustement",
  PROPOSITION_ACCEPTEE: "Proposition acceptée",
  PROPOSITION_DECLINEE: "Proposition déclinée",
  STATUT_ENGAGEMENT_CONFIRME: "Engagement confirmé par ATLAS",
  STATUT_EN_COURS: "Projet démarré",
  STATUT_TERMINE: "Projet terminé",
  STATUT_ABANDONNE: "Projet abandonné",
  ABANDON: "Projet abandonné",
  MISSION_RATTACHEE: "Mission rattachée au projet",
};

const VARIANT_STATUT: Partial<Record<StatutProjetValeur, BadgeVariant>> = {
  A_QUALIFIER: "warning",
  PROPOSITION_INDICATIVE: "info",
  PROPOSITION_VERIFIEE: "info",
  ACCEPTEE: "success",
  ENGAGEMENT_CONFIRME: "success",
  EN_COURS: "success",
  TERMINE: "neutral",
  ABANDONNE: "neutral",
};

function montant(n: number | null, devise: string) {
  return n === null ? null : `${n.toLocaleString("fr-FR")} ${devise}`;
}

export default function ProjetsClientPage() {
  const [projets, setProjets] = useState<Projet[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [creation, setCreation] = useState(false);

  function charger() {
    setErreur(false);
    fetch("/api/client/projets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setProjets(d.projets ?? []))
      .catch(() => setErreur(true));
  }

  useEffect(() => {
    charger();
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("type")) setCreation(true);
  }, []);

  return (
    <div>
      <Section
        title="Projets"
        action={!creation && <Bouton onClick={() => setCreation(true)}>Confier un projet</Bouton>}
      >
        <p style={{ color: grisTexte, fontSize: 13, margin: "-4px 0 12px" }}>
          Confiez à ATLAS un projet complet, avec un résultat attendu : nous le qualifions, vous proposons une approche, une équipe
          envisagée, des étapes, des livrables et un budget estimatif, puis nous en assurons le suivi jusqu&apos;à la livraison.
          Pour un renfort ponctuel, exprimez plutôt un <Link href="/client/besoins">besoin</Link>.
        </p>
        {creation && <AssistantProjet onFini={() => { setCreation(false); charger(); }} />}
        {erreur && (
          <Card>
            <p role="alert" style={{ margin: 0, fontSize: 13 }}>
              Impossible de charger vos projets pour le moment. <Bouton variant="secondary" onClick={charger}>Réessayer</Bouton>
            </p>
          </Card>
        )}
        {!erreur && projets === null && <p role="status" style={{ fontSize: 13, color: grisTexte }}>Chargement de vos projets…</p>}
        {projets && projets.length === 0 && !creation && <EmptyState message="Aucun projet pour l'instant. Cliquez sur « Confier un projet » pour commencer." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {projets?.map((p) => <CarteProjet key={p.id} projet={p} recharger={charger} />)}
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------ Assistant --

const ETAPES_ASSISTANT = ["Objectif", "Périmètre", "Calendrier et budget", "Validation"];

function AssistantProjet({ onFini }: { onFini: () => void }) {
  const [etape, setEtape] = useState(0);
  const [atlasOsActif, setAtlasOsActif] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<{ texte: string; manquants?: string[] } | null>(null);
  const [f, setF] = useState({
    type: "DELIVERY" as "DELIVERY" | "SERVICE_ATLAS_OS",
    titre: "",
    objectif: "",
    resultatAttendu: "",
    perimetre: "",
    exigencesTechniques: "",
    contraintes: "",
    calendrierSouhaite: "",
    budgetIndicatif: "",
  });

  useEffect(() => {
    fetch("/api/client/atlas-os", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const actif = d?.etat === "ACTIVE";
        setAtlasOsActif(actif);
        if (actif && new URLSearchParams(window.location.search).get("type") === "SERVICE_ATLAS_OS") setF((x) => ({ ...x, type: "SERVICE_ATLAS_OS" }));
      })
      .catch(() => setAtlasOsActif(false));
  }, []);

  const maj = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const etapeValide = etape !== 0 || (f.titre.trim() && f.objectif.trim() && f.resultatAttendu.trim());

  async function envoyer() {
    setErreur(null);
    setEnvoi(true);
    const r = await fetch("/api/client/projets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setEnvoi(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErreur({ texte: d.error ?? "Une erreur est survenue.", manquants: d.manquants });
      return;
    }
    onFini();
  }

  const champ = (id: keyof typeof f, libelle: string, aide?: string, long = false) => (
    <div style={{ fontSize: 13 }}>
      <label htmlFor={`projet-${id}`} style={{ display: "block", marginBottom: 4, color: grisTexte }}>{libelle}</label>
      {long ? (
        <textarea id={`projet-${id}`} value={f[id]} onChange={maj(id)} rows={3} style={styleChamp} />
      ) : (
        <input id={`projet-${id}`} value={f[id]} onChange={maj(id)} style={styleChamp} />
      )}
      {aide && <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "#7a8599" }}>{aide}</span>}
    </div>
  );

  return (
    <Card style={{ marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 16, color: bleuFonce }}>Confier un projet à ATLAS</h3>
      <ol aria-label="Étapes" style={{ display: "flex", gap: 12, listStyle: "none", padding: 0, margin: "8px 0 16px", flexWrap: "wrap" }}>
        {ETAPES_ASSISTANT.map((e, i) => (
          <li key={e} aria-current={i === etape ? "step" : undefined} style={{ fontSize: 12, fontWeight: i === etape ? 700 : 400, color: i === etape ? bleu : grisTexte }}>
            {i + 1}. {e}
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
        {etape === 0 && (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0, fontSize: 13 }}>
              <legend style={{ color: grisTexte, marginBottom: 4 }}>Type de projet</legend>
              <label style={{ display: "block" }}>
                <input type="radio" name="type" checked={f.type === "DELIVERY"} onChange={() => setF({ ...f, type: "DELIVERY" })} /> Projet de delivery
                (une équipe ATLAS réalise le projet)
              </label>
              <label style={{ display: "block", color: atlasOsActif ? undefined : "#9aa3b2" }}>
                <input type="radio" name="type" disabled={!atlasOsActif} checked={f.type === "SERVICE_ATLAS_OS"} onChange={() => setF({ ...f, type: "SERVICE_ATLAS_OS" })} />{" "}
                Prestation ATLAS OS (QA, sécurité, audit)
                {!atlasOsActif && (
                  <span style={{ fontSize: 11 }}>
                    {" "}— nécessite l&apos;<Link href="/client/atlas-os">activation d&apos;ATLAS OS</Link>
                  </span>
                )}
              </label>
            </fieldset>
            {champ("titre", "Titre du projet *")}
            {champ("objectif", "Objectif *", "Pourquoi ce projet ? Quel problème résout-il ?", true)}
            {champ("resultatAttendu", "Résultat attendu *", "Ce que vous devez obtenir à la fin : livrable, niveau de qualité, mise en production…", true)}
          </>
        )}
        {etape === 1 && (
          <>
            {champ("perimetre", "Périmètre", "Ce qui est inclus, et ce qui ne l'est pas.", true)}
            {champ("exigencesTechniques", "Exigences techniques", "Technologies, environnements, normes, outils imposés…", true)}
            {champ("contraintes", "Contraintes", "Réglementaires, organisationnelles, sécurité, accès…", true)}
          </>
        )}
        {etape === 2 && (
          <>
            {champ("calendrierSouhaite", "Calendrier souhaité", "Ex. : démarrage en janvier 2027, mise en production fin juin.")}
            {champ("budgetIndicatif", "Budget indicatif (facultatif)", "Un ordre de grandeur aide ATLAS à proposer une approche adaptée.")}
          </>
        )}
        {etape === 3 && (
          <dl style={{ margin: 0, fontSize: 13, display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: "6px 12px" }}>
            {(
              [
                ["Type", f.type === "DELIVERY" ? "Projet de delivery" : "Prestation ATLAS OS"],
                ["Titre", f.titre],
                ["Objectif", f.objectif],
                ["Résultat attendu", f.resultatAttendu],
                ["Périmètre", f.perimetre],
                ["Exigences techniques", f.exigencesTechniques],
                ["Contraintes", f.contraintes],
                ["Calendrier", f.calendrierSouhaite],
                ["Budget indicatif", f.budgetIndicatif],
              ] as const
            ).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ color: grisTexte }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v || <em style={{ color: "#9aa3b2" }}>non renseigné</em>}</dd>
              </div>
            ))}
          </dl>
        )}

        {erreur && (
          <div role="alert" style={{ color: "#c0392b", fontSize: 13 }}>
            {erreur.texte}
            {erreur.manquants && (
              <>
                {" "}
                <Link href="/client/profil#entreprise">Compléter mon profil entreprise</Link>
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {etape > 0 && <Bouton variant="secondary" onClick={() => setEtape(etape - 1)}>Précédent</Bouton>}
          {etape < 3 && (
            <Bouton onClick={() => setEtape(etape + 1)} disabled={!etapeValide}>
              Suivant
            </Bouton>
          )}
          {etape === 3 && (
            <Bouton onClick={envoyer} disabled={envoi}>
              {envoi ? "Envoi…" : "Confier ce projet à ATLAS"}
            </Bouton>
          )}
          <Bouton variant="tertiary" onClick={onFini}>Annuler</Bouton>
        </div>
      </div>
    </Card>
  );
}

const styleChamp = { width: "100%", padding: 8, borderRadius: 6, border: `1px solid ${bordure}`, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" } as const;

// --------------------------------------------------------------- Projet --

function CarteProjet({ projet, recharger }: { projet: Projet; recharger: () => void }) {
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const courante = projet.propositions.find((p) => p.statut === "PUBLIEE") ?? projet.propositions[0] ?? null;
  const indexEtape = ETAPES_PROJET.indexOf(projet.statut);

  async function agir(action: string, avecMessage = false) {
    setErreur(null);
    setSucces(null);
    setEnvoi(true);
    const r = await fetch(`/api/client/projets/${projet.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, propositionId: courante?.id, message: avecMessage ? message : undefined }),
    });
    setEnvoi(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErreur(d.error ?? "Une erreur est survenue.");
      return;
    }
    setMessage("");
    setSucces(action === "INTERET" ? "Votre intérêt a été transmis à l'équipe ATLAS." : action === "DEMANDE_PRECISION" ? "Votre demande a été transmise à l'équipe ATLAS." : null);
    recharger();
  }

  return (
    <section aria-label={`Projet : ${projet.titre}`}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: bleuFonce }}>{projet.titre}</h3>
          <span style={{ display: "flex", gap: 6 }}>
            {projet.type === "SERVICE_ATLAS_OS" && <Badge variant="info">Prestation ATLAS OS</Badge>}
            <Badge variant={VARIANT_STATUT[projet.statut] ?? "info"}>{LIBELLE_STATUT_PROJET[projet.statut]}</Badge>
          </span>
        </div>

        {projet.statut !== "ABANDONNE" && (
          <ol aria-label="Avancement du projet" style={{ display: "flex", gap: 4, listStyle: "none", padding: 0, margin: "12px 0", flexWrap: "wrap" }}>
            {ETAPES_PROJET.map((e, i) => (
              <li
                key={e}
                aria-current={i === indexEtape ? "step" : undefined}
                title={LIBELLE_STATUT_PROJET[e]}
                style={{ flex: "1 1 60px", height: 6, borderRadius: 3, background: i <= indexEtape ? bleu : bordure }}
              >
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {LIBELLE_STATUT_PROJET[e]} {i < indexEtape ? "(fait)" : i === indexEtape ? "(étape actuelle)" : "(à venir)"}
                </span>
              </li>
            ))}
          </ol>
        )}

        <p style={{ margin: "0 0 4px", fontSize: 13 }}><strong>Objectif :</strong> {projet.objectif}</p>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}><strong>Résultat attendu :</strong> {projet.resultatAttendu}</p>

        {(projet.statut === "A_QUALIFIER" || projet.statut === "QUALIFIE") && (
          <Qualification projet={projet} recharger={recharger} />
        )}

        {projet.competencesIdentifiees.length > 0 && (
          <p style={{ margin: "8px 0", fontSize: 12, color: grisTexte }}>
            Compétences identifiées par ATLAS dans votre description (à confirmer) : {projet.competencesIdentifiees.join(", ")}
          </p>
        )}

        {courante && <PropositionDetail proposition={courante} />}
        {projet.propositions.length >= 2 && <ComparaisonVersions propositions={projet.propositions} />}

        {courante?.statut === "PUBLIEE" && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {courante.niveau === "INDICATIVE" ? (
                <Bouton onClick={() => agir("INTERET")} disabled={envoi}>Cette proposition m&apos;intéresse</Bouton>
              ) : (
                <Bouton onClick={() => agir("ACCEPTER")} disabled={envoi}>Accepter la proposition</Bouton>
              )}
              <Bouton variant="secondary" onClick={() => agir("DECLINER")} disabled={envoi}>Décliner</Bouton>
            </div>
            <label style={{ fontSize: 12, color: grisTexte }}>
              Demander une précision ou un ajustement du périmètre
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={2000} style={{ ...styleChamp, marginTop: 4 }} />
            </label>
            <Bouton variant="secondary" onClick={() => agir("DEMANDE_PRECISION", true)} disabled={envoi || !message.trim()} style={{ alignSelf: "flex-start" }}>
              Envoyer la demande
            </Bouton>
          </div>
        )}

        {erreur && <p role="alert" style={{ color: "#c0392b", fontSize: 13 }}>{erreur} {erreur.includes("profil entreprise") && <Link href="/client/profil#entreprise">Compléter mon profil</Link>}</p>}
        {succes && <p role="status" style={{ fontSize: 13, color: "#1e7e46" }}>{succes}</p>}

        {projet.missions.length > 0 && (
          <p style={{ margin: "12px 0 0", fontSize: 13 }}>
            Missions du projet : {projet.missions.map((m) => m.repere ?? "Mission").join(", ")} — <Link href="/client/missions">voir les missions</Link>
          </p>
        )}

        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, color: grisTexte, cursor: "pointer" }}>Historique du projet</summary>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {projet.evenements.map((e) => (
              <li key={e.id} style={{ fontSize: 12, padding: "4px 0", borderTop: `1px solid ${bordure}` }}>
                <time dateTime={e.le} style={{ color: grisTexte }}>{new Date(e.le).toLocaleDateString("fr-FR")}</time> — {LIBELLE_EVENEMENT[e.type] ?? "Mise à jour"} ({e.auteur})
                {e.detail && <span style={{ color: grisTexte }}> · {e.detail}</span>}
                {e.statutTraitement && (
                  <span style={{ fontWeight: 600 }}>
                    {" "}
                    — {e.statutTraitement === "ENVOYEE" ? "transmise à l'équipe ATLAS" : e.statutTraitement === "PRISE_EN_CHARGE" ? "prise en charge par l'équipe ATLAS" : "traitée"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>

        {["A_QUALIFIER", "QUALIFIE", "PROPOSITION_INDICATIVE", "PROPOSITION_VERIFIEE"].includes(projet.statut) && (
          <Bouton variant="tertiary" onClick={() => window.confirm("Abandonner ce projet ?") && agir("ABANDONNER")} disabled={envoi} style={{ marginTop: 8 }}>
            Abandonner le projet
          </Bouton>
        )}
      </Card>
    </section>
  );
}

function Qualification({ projet, recharger }: { projet: Projet; recharger: () => void }) {
  const [edition, setEdition] = useState(false);
  const [v, setV] = useState({
    perimetre: projet.perimetre ?? "",
    exigencesTechniques: projet.exigencesTechniques ?? "",
    contraintes: projet.contraintes ?? "",
    calendrierSouhaite: projet.calendrierSouhaite ?? "",
    budgetIndicatif: projet.budgetIndicatif ?? "",
  });
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer() {
    setErreur(null);
    const r = await fetch(`/api/client/projets/${projet.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    if (!r.ok) {
      setErreur((await r.json().catch(() => ({}))).error ?? "Une erreur est survenue.");
      return;
    }
    setEdition(false);
    recharger();
  }

  const { requises, utiles } = projet.manquants;
  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 10, margin: "8px 0", fontSize: 13 }}>
      {projet.statut === "A_QUALIFIER" ? (
        requises.length > 0 ? (
          <p style={{ margin: 0 }}>
            <Badge variant="warning">À compléter</Badge> Pour qualifier votre projet, ATLAS a besoin de : {requises.join(", ")}.
          </p>
        ) : (
          <p style={{ margin: 0 }}>Votre projet est complet : l&apos;équipe ATLAS le qualifie et prépare une proposition.</p>
        )
      ) : (
        <p style={{ margin: 0 }}>Projet qualifié : l&apos;équipe ATLAS prépare une proposition.</p>
      )}
      {utiles.length > 0 && <p style={{ margin: "4px 0 0", color: grisTexte, fontSize: 12 }}>Utile aussi : {utiles.join(", ")}.</p>}
      {!edition ? (
        <Bouton variant="tertiary" onClick={() => setEdition(true)}>Compléter le projet</Bouton>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {(
            [
              ["perimetre", "Périmètre"],
              ["exigencesTechniques", "Exigences techniques"],
              ["contraintes", "Contraintes"],
              ["calendrierSouhaite", "Calendrier souhaité"],
              ["budgetIndicatif", "Budget indicatif"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} style={{ fontSize: 12, color: grisTexte }}>
              {l}
              <textarea value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} rows={2} style={{ ...styleChamp, marginTop: 4 }} />
            </label>
          ))}
          {erreur && <p role="alert" style={{ color: "#c0392b", margin: 0 }}>{erreur}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <Bouton onClick={enregistrer}>Enregistrer</Bouton>
            <Bouton variant="secondary" onClick={() => setEdition(false)}>Annuler</Bouton>
          </div>
        </div>
      )}
    </div>
  );
}

function PropositionDetail({ proposition: p }: { proposition: Proposition }) {
  const budget =
    p.budgetEstimeMin !== null || p.budgetEstimeMax !== null
      ? [montant(p.budgetEstimeMin, p.devise), montant(p.budgetEstimeMax, p.devise)].filter(Boolean).join(" à ")
      : null;
  return (
    <div style={{ border: `1px solid ${p.niveau === "VERIFIEE" ? "#bfe3cc" : bordure}`, borderRadius: 8, padding: 12, marginTop: 8, background: p.niveau === "VERIFIEE" ? "#f4faf6" : "#fafbfd" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>Proposition — version {p.version}</strong>
        <Badge variant={p.niveau === "VERIFIEE" ? "success" : "warning"}>
          {p.niveau === "VERIFIEE" ? "Vérifiée par l'équipe ATLAS" : "Indicative — estimation non engageante"}
        </Badge>
      </div>
      {p.niveau === "INDICATIVE" && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: grisTexte }}>
          Équipe, budget et délais sont des estimations : ils seront vérifiés par ATLAS avant tout engagement.
        </p>
      )}
      <p style={{ margin: "8px 0 4px", fontSize: 13 }}><strong>Approche :</strong> {p.approche}</p>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}><strong>Périmètre :</strong> {p.perimetre}</p>
      {p.equipe.length > 0 && (
        <p style={{ margin: "0 0 4px", fontSize: 13 }}>
          <strong>Équipe {p.niveau === "VERIFIEE" ? "prévue" : "envisagée"} :</strong>{" "}
          {p.equipe.map((r) => `${r.nombre} × ${r.role}${r.competences.length ? ` (${r.competences.join(", ")})` : ""}`).join(" ; ")}
        </p>
      )}
      {p.etapes.length > 0 && (
        <ol style={{ margin: "4px 0 8px", paddingLeft: 18, fontSize: 13 }}>
          {p.etapes.map((e, i) => (
            <li key={i}>
              {e.nom}
              {e.dureeEstimee && <span style={{ color: grisTexte }}> — {e.dureeEstimee}</span>}
              {e.livrables.length > 0 && <span style={{ color: grisTexte }}> · Livrables : {e.livrables.join(", ")}</span>}
            </li>
          ))}
        </ol>
      )}
      <p style={{ margin: "0 0 4px", fontSize: 13 }}>
        <strong>Délai {p.niveau === "VERIFIEE" ? "" : "estimé"} :</strong> {p.delaiEstime ?? "à préciser"} · <strong>Budget {p.niveau === "VERIFIEE" ? "" : "estimatif"} :</strong>{" "}
        {budget ?? "à préciser"}
      </p>
      {p.hypotheses.length > 0 && <p style={{ margin: "0 0 4px", fontSize: 12, color: grisTexte }}>Hypothèses : {p.hypotheses.join(" ; ")}</p>}
      {p.exclusions.length > 0 && <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>Exclusions : {p.exclusions.join(" ; ")}</p>}
      {p.statut !== "PUBLIEE" && (
        <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 600 }}>
          {p.statut === "ACCEPTEE" ? "Vous avez accepté cette proposition." : p.statut === "DECLINEE" ? "Vous avez décliné cette proposition." : "Remplacée par une version plus récente."}
        </p>
      )}
    </div>
  );
}

function ComparaisonVersions({ propositions }: { propositions: Proposition[] }) {
  const versions = [...propositions].sort((a, b) => a.version - b.version).slice(-3);
  const lignes: [string, (p: Proposition) => string][] = [
    ["Niveau", (p) => (p.niveau === "VERIFIEE" ? "Vérifiée" : "Indicative")],
    ["Équipe", (p) => p.equipe.map((r) => `${r.nombre} × ${r.role}`).join(", ") || "—"],
    ["Étapes", (p) => String(p.etapes.length)],
    ["Délai", (p) => p.delaiEstime ?? "—"],
    ["Budget", (p) => [montant(p.budgetEstimeMin, p.devise), montant(p.budgetEstimeMax, p.devise)].filter(Boolean).join(" à ") || "—"],
    ["Statut", (p) => ({ PUBLIEE: "En cours", ACCEPTEE: "Acceptée", DECLINEE: "Déclinée", REMPLACEE: "Remplacée" })[p.statut]],
  ];
  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 320 }}>
        <caption style={{ textAlign: "left", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Comparer les versions proposées</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left", padding: 6, color: grisTexte }}>Critère</th>
            {versions.map((p) => (
              <th key={p.id} scope="col" style={{ textAlign: "left", padding: 6 }}>Version {p.version}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map(([l, f]) => (
            <tr key={l} style={{ borderTop: `1px solid ${bordure}` }}>
              <th scope="row" style={{ textAlign: "left", padding: 6, color: grisTexte, fontWeight: 500 }}>{l}</th>
              {versions.map((p) => (
                <td key={p.id} style={{ padding: 6 }}>{f(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
