"use client";

import { useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import { prioriserClarifications, type Clarification } from "@/lib/client-need/clarification";
import { SolutionsBesoin } from "@/components/client/SolutionsBesoin";

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
// Remplace le "Bientôt disponible" du LOT 1 — premier point d'entrée réel
// pour exprimer un besoin en texte libre. Saisie -> extraction serveur
// (lib/client-need/extraction.ts) -> compréhension affichée avec sa
// provenance (VERIFIE/DECLARE/INFERE/INCONNU) et son statut de cohérence.
// Aucune décision de routage Talent/ATLAS OS affichée comme un fait acquis
// (HYPOTHESE_DOMAINE_SOLUTION reste étiquetée comme hypothèse).
//
// LOT 3 (15/09/2026) : l'historique complet des ClientNeedFait reste
// additif côté données (jamais affiché tel quel ici) — seule la DERNIÈRE
// valeur par clé (dernierFaitParCle) est présentée, avec une section
// "Questions à préciser" permettant de confirmer/corriger sans jamais
// réécrire l'historique.

type Fait = { id: string; cle: string; valeur: string; statut: "VERIFIE" | "DECLARE" | "INFERE" | "INCONNU"; source: string | null; createdAt: string };
type ReglesCoherence = { regle: string; statut: string; explication: string }[];
type Besoin = {
  id: string;
  titre: string | null;
  texteOriginal: string;
  statut: "BROUILLON" | "SOUMIS" | "A_CLARIFIER" | "VALIDE" | "ARCHIVE";
  coherenceStatut: "COHERENT" | "INCONSISTENT" | "NEEDS_CLARIFICATION" | "UNKNOWN";
  coherenceDetail: ReglesCoherence | null;
  createdAt: string;
  faits: Fait[];
  // LOT 5 (15/09/2026) : dérivé côté serveur (relation DemandeTalent →
  // ClientNeed), jamais un nouveau statut de besoin — indique uniquement
  // qu'une démarche Talent a été engagée par notre équipe, jamais aucun
  // détail interne de la demande elle-même.
  demarcheTalentEngagee: boolean;
  // LOT 6 (16/09/2026) : dérivé côté serveur (relation Mission →
  // DemandeTalent → ClientNeed), jamais un nouveau statut de besoin, jamais
  // aucun détail interne de la mission (tarifs, ingénieur, marge).
  missionEnCours: boolean;
};

const LABEL_CLE: Record<string, string> = {
  OBJECTIF: "Objectif",
  ROLE: "Rôle",
  QUANTITE: "Quantité",
  SENIORITE: "Séniorité",
  ANNEES_EXPERIENCE_MIN: "Années d'expérience min.",
  COMPETENCE: "Compétence",
  BUDGET_MONTANT: "Budget",
  BUDGET_DEVISE: "Devise",
  BUDGET_TYPE: "Type de budget",
  BUDGET_FREQUENCE: "Fréquence",
  DUREE: "Durée",
  DATE_DEBUT: "Date de début",
  DISPONIBILITE: "Disponibilité",
  LOCALISATION: "Localisation",
  REMOTE: "Télétravail",
  CONTRAINTE: "Contrainte",
  CRITERE_REUSSITE: "Critère de réussite",
  PRIORITE: "Priorité",
  RISQUE: "Risque",
  PREFERENCE: "Préférence",
  HYPOTHESE_DOMAINE_SOLUTION: "Hypothèse — domaine de solution",
};

const LABEL_STATUT_BESOIN: Record<string, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis",
  A_CLARIFIER: "À clarifier",
  VALIDE: "Validé",
  ARCHIVE: "Archivé",
};

const VARIANT_COHERENCE: Record<string, BadgeVariant> = {
  COHERENT: "success",
  INCONSISTENT: "error",
  NEEDS_CLARIFICATION: "warning",
  UNKNOWN: "neutral",
};

const LABEL_COHERENCE: Record<string, string> = {
  COHERENT: "Cohérent",
  INCONSISTENT: "Contradiction détectée",
  NEEDS_CLARIFICATION: "À préciser",
  UNKNOWN: "Non évalué",
};

const VARIANT_PROVENANCE: Record<string, BadgeVariant> = {
  VERIFIE: "success",
  DECLARE: "info",
  INFERE: "neutral",
  INCONNU: "warning",
};

const LABEL_PROVENANCE: Record<string, string> = {
  VERIFIE: "Vérifié",
  DECLARE: "Déclaré par vous",
  INFERE: "Déduit par ATLAS",
  INCONNU: "Inconnu",
};

// LOT 3 — distingue confirmation et correction explicites du client
// (statut VERIFIE dans les deux cas) via le champ `source`, plutôt qu'un
// simple "Vérifié" générique — voir directive CEO LOT 3 §6.
function libelleProvenance(fait: Pick<Fait, "statut" | "source">): string {
  if (fait.statut === "VERIFIE" && fait.source === "client_confirmation") return "Confirmé par vous";
  if (fait.statut === "VERIFIE" && fait.source === "client_correction") return "Corrigé par vous";
  return LABEL_PROVENANCE[fait.statut] ?? fait.statut;
}

const LABEL_PRIORITE_CLARIFICATION: Record<Clarification["priorite"], string> = {
  CONTRADICTION: "Contradiction à résoudre",
  A_PRECISER: "À préciser",
  MANQUANT: "Information manquante",
};

const VARIANT_PRIORITE_CLARIFICATION: Record<Clarification["priorite"], BadgeVariant> = {
  CONTRADICTION: "error",
  A_PRECISER: "warning",
  MANQUANT: "neutral",
};

export default function BesoinsClientPage() {
  const [besoins, setBesoins] = useState<Besoin[]>([]);
  const [chargement, setChargement] = useState(true);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());

  function charger() {
    fetch("/api/client/besoins")
      .then((r) => r.json())
      .then((d) => {
        setBesoins(d.besoins ?? []);
        setChargement(false);
      });
  }

  useEffect(() => {
    charger();
  }, []);

  function basculer(id: string) {
    setOuverts((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  return (
    <div>
      <Section title="Exprimer un besoin">
        <p style={{ color: grisTexte, fontSize: 13, margin: "-4px 0 12px" }}>
          Décrivez votre besoin en quelques phrases, en langage naturel. ATLAS l&apos;analyse et vous montre ce qu&apos;il a
          compris — vous restez toujours libre de le compléter ou de le corriger.
        </p>
        <FormulaireBesoin onCree={charger} />
      </Section>

      <Section title="Vos besoins">
        {chargement && <EmptyState message="Chargement…" />}
        {!chargement && besoins.length === 0 && <EmptyState message="Aucun besoin exprimé pour l'instant." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {besoins.map((b) => (
            <CarteBesoin key={b.id} besoin={b} ouvert={ouverts.has(b.id)} basculer={() => basculer(b.id)} recharger={charger} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function FormulaireBesoin({ onCree }: { onCree: () => void }) {
  const [texteOriginal, setTexteOriginal] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch("/api/client/besoins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texteOriginal }),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(data.error ?? "Une erreur est survenue.");
      return;
    }
    setTexteOriginal("");
    onCree();
  }

  return (
    <Card>
      <textarea
        placeholder="Ex. : Nous cherchons deux QA automation seniors pour renforcer notre équipe pendant six mois, principalement sur Playwright et Java, avec possibilité de remote."
        value={texteOriginal}
        onChange={(e) => setTexteOriginal(e.target.value)}
        rows={4}
        style={{ width: "100%", padding: 8, fontFamily: "inherit", marginBottom: 8, borderRadius: 6 }}
      />
      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 8px" }}>{erreur}</p>}
      <Bouton onClick={envoyer} disabled={texteOriginal.trim().length < 10 || envoi}>
        {envoi ? "Analyse en cours…" : "Envoyer"}
      </Bouton>
    </Card>
  );
}

function CarteBesoin({
  besoin,
  ouvert,
  basculer,
  recharger,
}: {
  besoin: Besoin;
  ouvert: boolean;
  basculer: () => void;
  recharger: () => void;
}) {
  // LOT 3 : seule la DERNIÈRE valeur par clé est affichée — l'historique
  // complet (additif, jamais écrasé) reste disponible côté données/audit
  // mais n'est jamais montré tel quel dans l'Espace Client.
  const dernierParCle = dernierFaitParCle(besoin.faits);
  const faitsActuels = [...dernierParCle.values()];
  const faitsConnus = faitsActuels.filter((f) => f.statut !== "INCONNU" && f.cle !== "HYPOTHESE_DOMAINE_SOLUTION");
  const hypothese = dernierParCle.get("HYPOTHESE_DOMAINE_SOLUTION");

  const clarifications = prioriserClarifications(
    new Map(faitsActuels.map((f) => [f.cle, { valeur: f.valeur, statut: f.statut }])),
    besoin.coherenceDetail ?? []
  );

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ cursor: "pointer", flex: 1 }} onClick={basculer}>
          <p style={{ margin: 0, fontWeight: 600 }}>{besoin.titre ?? besoin.texteOriginal.slice(0, 70)}</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: grisTexte }}>{besoin.texteOriginal}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <Badge variant="info">{LABEL_STATUT_BESOIN[besoin.statut]}</Badge>
          <Badge variant={VARIANT_COHERENCE[besoin.coherenceStatut]}>{LABEL_COHERENCE[besoin.coherenceStatut]}</Badge>
          {besoin.missionEnCours ? (
            <Badge variant="success">Mission en cours</Badge>
          ) : (
            besoin.demarcheTalentEngagee && <Badge variant="success">Démarche Talent engagée</Badge>
          )}
        </div>
      </div>

      {ouvert && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 14 }}>
          {faitsConnus.length > 0 && (
            <div>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>ATLAS comprend</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {faitsConnus.map((f) => (
                  <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>
                      {LABEL_CLE[f.cle] ?? f.cle} : <strong>{f.valeur}</strong>
                    </span>
                    <Badge variant={VARIANT_PROVENANCE[f.statut]}>{libelleProvenance(f)}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {clarifications.length > 0 && (
            <div>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Questions à préciser</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {clarifications.map((c) => (
                  <QuestionClarification key={c.cle} besoinId={besoin.id} clarification={c} recharger={recharger} />
                ))}
              </div>
            </div>
          )}

          {hypothese && hypothese.valeur !== "INCONNU" && (
            <div>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Hypothèse ATLAS (à confirmer)</p>
              <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>
                Domaine probable : <strong>{hypothese.valeur}</strong>{" "}
                <Badge variant="neutral">{LABEL_PROVENANCE.INFERE}</Badge>
              </p>
            </div>
          )}

          {besoin.coherenceDetail && besoin.coherenceDetail.length > 0 && (
            <div>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Analyse de cohérence</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {besoin.coherenceDetail.map((r, i) => (
                  <p key={i} style={{ margin: 0, fontSize: 12, color: grisTexte }}>
                    {r.explication}
                  </p>
                ))}
              </div>
            </div>
          )}

          {besoin.statut === "VALIDE" && (
            <div>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Solutions possibles</p>
              <SolutionsBesoin besoinId={besoin.id} statutBesoin={besoin.statut} />
            </div>
          )}

          <ActionsBesoin besoin={besoin} recharger={recharger} />
        </div>
      )}
    </Card>
  );
}

// LOT 3 : une question par clé clarifiable — Confirmer (garde la valeur
// actuelle, statut VERIFIE, source client_confirmation) ou Corriger (nouvelle
// valeur, statut VERIFIE, source client_correction). Jamais de mutation en
// place : chaque réponse crée une nouvelle ClientNeedFait côté serveur.
function QuestionClarification({
  besoinId,
  clarification,
  recharger,
}: {
  besoinId: string;
  clarification: Clarification;
  recharger: () => void;
}) {
  const [correction, setCorrection] = useState(false);
  const [valeur, setValeur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function repondre(action: "CONFIRMER" | "CORRIGER") {
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch(`/api/client/besoins/${besoinId}/faits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle: clarification.cle, action, valeur: action === "CORRIGER" ? valeur : undefined }),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(data.error ?? "Une erreur est survenue.");
      return;
    }
    setValeur("");
    setCorrection(false);
    recharger();
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{LABEL_CLE[clarification.cle] ?? clarification.cle}</p>
          {clarification.explication && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>{clarification.explication}</p>
          )}
          {clarification.valeurActuelle && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
              Valeur actuelle : <strong>{clarification.valeurActuelle}</strong>
            </p>
          )}
        </div>
        <Badge variant={VARIANT_PRIORITE_CLARIFICATION[clarification.priorite]}>
          {LABEL_PRIORITE_CLARIFICATION[clarification.priorite]}
        </Badge>
      </div>

      {erreur && <p style={{ color: "#c0392b", fontSize: 12, margin: "6px 0 0" }}>{erreur}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        {clarification.valeurActuelle && !correction && (
          <Bouton variant="secondary" onClick={() => repondre("CONFIRMER")} disabled={envoi}>
            Confirmer
          </Bouton>
        )}
        {!correction && (
          <Bouton variant="secondary" onClick={() => setCorrection(true)} disabled={envoi}>
            Corriger
          </Bouton>
        )}
        {correction && (
          <>
            <input
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              placeholder="Nouvelle valeur"
              style={{ padding: 6, borderRadius: 6, fontFamily: "inherit", fontSize: 13 }}
            />
            <Bouton onClick={() => repondre("CORRIGER")} disabled={envoi || valeur.trim().length === 0}>
              Envoyer
            </Bouton>
            <Bouton variant="secondary" onClick={() => setCorrection(false)} disabled={envoi}>
              Annuler
            </Bouton>
          </>
        )}
      </div>
    </div>
  );
}

function ActionsBesoin({ besoin, recharger }: { besoin: Besoin; recharger: () => void }) {
  const [envoi, setEnvoi] = useState(false);

  async function changerStatut(statut: string) {
    setEnvoi(true);
    await fetch(`/api/client/besoins/${besoin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut }),
    });
    setEnvoi(false);
    recharger();
  }

  async function supprimer() {
    setEnvoi(true);
    await fetch(`/api/client/besoins/${besoin.id}`, { method: "DELETE" });
    setEnvoi(false);
    recharger();
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {besoin.statut !== "VALIDE" && (
        <Bouton variant="secondary" onClick={() => changerStatut("VALIDE")} disabled={envoi}>
          Valider ce besoin
        </Bouton>
      )}
      {besoin.statut !== "ARCHIVE" && (
        <Bouton variant="secondary" onClick={() => changerStatut("ARCHIVE")} disabled={envoi}>
          Archiver
        </Bouton>
      )}
      <Bouton variant="secondary" onClick={supprimer} disabled={envoi} style={{ color: "#c0392b" }}>
        Supprimer
      </Bouton>
    </div>
  );
}
