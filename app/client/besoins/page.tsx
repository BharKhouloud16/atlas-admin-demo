"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";
import { dernierFaitParCle, valeursActuellesRepetables, CLES_REPETABLES } from "@/lib/client-need/faits";
import { prioriserClarifications, CLES_CLARIFIABLES, type Clarification } from "@/lib/client-need/clarification";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { SolutionsBesoin } from "@/components/client/SolutionsBesoin";
import { AssistantBesoin } from "@/components/client/AssistantBesoin";

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
  // REV-01 (01/11/2026) : projet porté par ce besoin, le cas échéant.
  projet?: { id: string; titre: string; statut: string } | null;
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
  if (fait.statut === "VERIFIE" && fait.source === "client_ajout") return "Ajouté par vous";
  // LOT 1 (ANO-03) : une valeur lue automatiquement dans votre texte est une
  // INTERPRÉTATION d'ATLAS, à vérifier — jamais présentée comme « déclarée ».
  if (fait.statut === "DECLARE" && fait.source === "extraction") return "Compris par ATLAS";
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

  const [erreurChargement, setErreurChargement] = useState(false);

  // LOT 1 (ANO-05) : jamais de réponse mise en cache, et une erreur réseau ou
  // serveur affiche un message au lieu d'un chargement infini.
  function charger() {
    fetch("/api/client/besoins", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setBesoins(d.besoins ?? []);
        setErreurChargement(false);
      })
      .catch(() => setErreurChargement(true))
      .finally(() => setChargement(false));
  }

  // LOT 1 (ANO-05) : la réponse du serveur à une correction contient le
  // besoin à jour — il remplace immédiatement la carte, sans attendre un
  // rechargement de la liste.
  function remplacer(maj: Partial<Besoin> & { id: string }) {
    setBesoins((prev) => prev.map((b) => (b.id === maj.id ? { ...b, ...maj } : b)));
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
          Décrivez votre besoin et précisez vos critères. ATLAS l&apos;analyse et vous montre ce qu&apos;il a compris — vous
          restez toujours libre de le compléter ou de le corriger.
        </p>
        <AssistantBesoin onCree={charger} />
      </Section>

      <Section title="Vos besoins">
        {chargement && <EmptyState message="Chargement…" />}
        {!chargement && erreurChargement && (
          <Card>
            <p role="alert" style={{ margin: 0, fontSize: 13 }}>
              Impossible de charger vos besoins pour le moment.{" "}
              <Bouton variant="secondary" onClick={charger}>Réessayer</Bouton>
            </p>
          </Card>
        )}
        {!chargement && !erreurChargement && besoins.length === 0 && <EmptyState message="Aucun besoin exprimé pour l'instant." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {besoins.map((b) => (
            <CarteBesoin key={b.id} besoin={b} ouvert={ouverts.has(b.id)} basculer={() => basculer(b.id)} recharger={charger} remplacer={remplacer} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function CarteBesoin({
  besoin,
  ouvert,
  basculer,
  recharger,
  remplacer,
}: {
  besoin: Besoin;
  ouvert: boolean;
  basculer: () => void;
  recharger: () => void;
  remplacer: (maj: Partial<Besoin> & { id: string }) => void;
}) {
  // LOT 3 : seule la DERNIÈRE valeur par clé est affichée — l'historique
  // complet (additif, jamais écrasé) reste disponible côté données/audit
  // mais n'est jamais montré tel quel dans l'Espace Client.
  const dernierParCle = dernierFaitParCle(besoin.faits);
  const faitsActuels = [...dernierParCle.values()];
  // LOT 1 (ANO-04) : les clés répétables (compétences…) sont affichées
  // TOUTES, à part ; « dernière valeur par clé » ne vaut que pour les autres.
  const faitsConnus = faitsActuels.filter((f) => f.statut !== "INCONNU" && f.cle !== "HYPOTHESE_DOMAINE_SOLUTION" && !CLES_REPETABLES.has(f.cle));
  const competences = valeursActuellesRepetables(besoin.faits, "COMPETENCE");
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
                  <FaitModifiable key={f.id} besoinId={besoin.id} fait={f} remplacer={remplacer} />
                ))}
              </div>
            </div>
          )}

          <CompetencesBesoin besoinId={besoin.id} competences={competences} remplacer={remplacer} />

          {clarifications.length > 0 && (
            <div>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Questions à préciser</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {clarifications.map((c) => (
                  <QuestionClarification key={c.cle} besoinId={besoin.id} clarification={c} remplacer={remplacer} />
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
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                <Link href={`/client/talent#besoin-${besoin.id}`}>Comparer les profils proposés et indiquer avec lesquels poursuivre →</Link>
              </p>
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
  remplacer,
}: {
  besoinId: string;
  clarification: Clarification;
  remplacer: (maj: Partial<Besoin> & { id: string }) => void;
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
    const data = await reponse.json().catch(() => null);
    setValeur("");
    setCorrection(false);
    if (data?.besoin) remplacer(data.besoin);
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
  const [erreur, setErreur] = useState<string | null>(null);
  // REV-01 (01/11/2026) : un besoin qui porte un projet se gère depuis
  // l'onglet Projets — ni suppression, ni archivage tant que le projet vit.
  const projetActif = besoin.projet && !["ABANDONNE", "TERMINE"].includes(besoin.projet.statut);

  async function appeler(init: RequestInit) {
    setErreur(null);
    setEnvoi(true);
    const r = await fetch(`/api/client/besoins/${besoin.id}`, init).catch(() => null);
    setEnvoi(false);
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {};
      setErreur(d.error ?? "L'opération n'a pas pu être effectuée. Réessayez.");
      return;
    }
    recharger();
  }

  const changerStatut = (statut: string) =>
    appeler({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statut }) });

  function supprimer() {
    if (!window.confirm("Supprimer définitivement ce besoin ?")) return;
    appeler({ method: "DELETE" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {besoin.projet && (
        <p style={{ margin: 0, fontSize: 13 }}>
          Ce besoin porte le projet{" "}
          <Link href="/client/projets">« {besoin.projet.titre} »</Link>
          {projetActif ? " : il se gère depuis l'onglet Projets." : "."}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {besoin.statut !== "VALIDE" && (
          <Bouton variant="secondary" onClick={() => changerStatut("VALIDE")} disabled={envoi}>
            Valider ce besoin
          </Bouton>
        )}
        {besoin.statut !== "ARCHIVE" && !projetActif && (
          <Bouton variant="secondary" onClick={() => changerStatut("ARCHIVE")} disabled={envoi}>
            Archiver
          </Bouton>
        )}
        {!besoin.projet && (
          <Bouton variant="secondary" onClick={supprimer} disabled={envoi} style={{ color: "#c0392b" }}>
            Supprimer
          </Bouton>
        )}
      </div>
      {erreur && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "#c0392b" }}>
          {erreur}
        </p>
      )}
    </div>
  );
}

// LOT 1 (28/10/2026, ANO-03) : toute valeur comprise par ATLAS peut être
// corrigée par le client, pas seulement les informations manquantes — une
// interprétation fausse (ex. un budget lu comme « 2027 ») ne doit jamais
// rester bloquée jusqu'à la validation du besoin.
const CLES_CORRIGEABLES = new Set<string>(CLES_CLARIFIABLES);

async function envoyerFait(besoinId: string, corps: { cle: string; action: string; valeur?: string }) {
  const reponse = await fetch(`/api/client/besoins/${besoinId}/faits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(data.error ?? "Une erreur est survenue.");
  return data.besoin as (Partial<Besoin> & { id: string }) | undefined;
}

function FaitModifiable({
  besoinId,
  fait,
  remplacer,
}: {
  besoinId: string;
  fait: Fait;
  remplacer: (maj: Partial<Besoin> & { id: string }) => void;
}) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(fait.valeur);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const corrigeable = CLES_CORRIGEABLES.has(fait.cle);
  const libelle = LABEL_CLE[fait.cle] ?? fait.cle;

  async function enregistrer() {
    setErreur(null);
    setEnvoi(true);
    try {
      const maj = await envoyerFait(besoinId, { cle: fait.cle, action: "CORRIGER", valeur });
      setEdition(false);
      if (maj) remplacer(maj);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>
          {libelle} : <strong>{fait.valeur}</strong>
        </span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge variant={VARIANT_PROVENANCE[fait.statut]}>{libelleProvenance(fait)}</Badge>
          {corrigeable && !edition && (
            <Bouton variant="secondary" onClick={() => { setValeur(fait.valeur); setEdition(true); }} aria-label={`Corriger : ${libelle}`}>
              Corriger
            </Bouton>
          )}
        </span>
      </div>
      {edition && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12 }}>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Nouvelle valeur pour {libelle}</span>
            <input
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              style={{ padding: 6, borderRadius: 6, fontFamily: "inherit", fontSize: 13 }}
            />
          </label>
          <Bouton onClick={enregistrer} disabled={envoi || valeur.trim().length === 0}>
            {envoi ? "Enregistrement…" : "Enregistrer"}
          </Bouton>
          <Bouton variant="secondary" onClick={() => setEdition(false)} disabled={envoi}>
            Annuler
          </Bouton>
        </div>
      )}
      {erreur && <p role="alert" style={{ color: "#c0392b", fontSize: 12, margin: 0 }}>{erreur}</p>}
    </div>
  );
}

// LOT 1 (ANO-04) : toutes les compétences actuelles, chacune retirable, et
// ajout depuis la liste fermée utilisée par le matching.
function CompetencesBesoin({
  besoinId,
  competences,
  remplacer,
}: {
  besoinId: string;
  competences: Fait[];
  remplacer: (maj: Partial<Besoin> & { id: string }) => void;
}) {
  const [ajout, setAjout] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const presentes = new Set(competences.map((c) => c.valeur));
  const disponibles = TOUTES_COMPETENCES.filter((c) => !presentes.has(c));

  async function agir(action: "AJOUTER" | "RETIRER", valeur: string) {
    setErreur(null);
    setEnvoi(true);
    try {
      const maj = await envoyerFait(besoinId, { cle: "COMPETENCE", action, valeur });
      if (action === "AJOUTER") setAjout("");
      if (maj) remplacer(maj);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Compétences recherchées</p>
      {competences.length === 0 && <p style={{ margin: "0 0 6px", fontSize: 13, color: grisTexte }}>Aucune compétence reconnue pour l&apos;instant.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {competences.map((c) => (
          <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid #dde3ea", borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: 13 }}>
            <span>{c.valeur}</span>
            <Badge variant={VARIANT_PROVENANCE[c.statut]}>{libelleProvenance(c)}</Badge>
            <button
              type="button"
              onClick={() => agir("RETIRER", c.valeur)}
              disabled={envoi}
              aria-label={`Retirer la compétence ${c.valeur}`}
              style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 14, padding: "0 6px" }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: grisTexte }}>
          Ajouter une compétence{" "}
          <select value={ajout} onChange={(e) => setAjout(e.target.value)} style={{ padding: 6, borderRadius: 6, fontSize: 13 }}>
            <option value="">Choisir…</option>
            {disponibles.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <Bouton variant="secondary" onClick={() => agir("AJOUTER", ajout)} disabled={envoi || !ajout}>
          Ajouter
        </Bouton>
      </div>
      {erreur && <p role="alert" style={{ color: "#c0392b", fontSize: 12, margin: "6px 0 0" }}>{erreur}</p>}
    </div>
  );
}
