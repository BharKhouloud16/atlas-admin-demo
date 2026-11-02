"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bordure, grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";

// LOT 2 (28/10/2026) — Espace Talents : suivre les profils PROPOSÉS pour vos
// besoins, les comparer, demander d'autres profils, indiquer avec lesquels
// vous souhaitez poursuivre. Ce n'est ni un catalogue d'ingénieurs ni un
// second formulaire de besoin (registre OBS-01) : un besoin s'exprime dans
// « Besoins ». Les profils restent anonymes ; manifester un intérêt ne crée
// aucune mission et ne révèle aucune identité.

type EtatAction = { type: "POURSUIVRE" | "NE_PAS_RETENIR"; statut: "ENVOYEE" | "PRISE_EN_CHARGE" | "CLOTUREE"; le: string };

type ProfilPropose = {
  cle: string;
  libelle: string;
  origine: "MATCHING" | "EQUIPE_ATLAS";
  niveauCorrespondance: "FORTE" | "PARTIELLE" | null;
  niveauConfiance: "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE" | null;
  competencesCorrespondantes: string[];
  competencesManquantes: string[];
  criteresAPreciser: string[];
  disponibilite: string | null;
  seniorite: string | null;
  anneesExperience: number | null;
  justification: string | null;
  recommande: boolean;
  cible: { solutionOptionId?: string; shortlistEntreeId?: string };
  derniereAction: EtatAction | null;
};

type SuiviBesoin = {
  besoinId: string;
  titre: string;
  eligible: boolean;
  raison: string | null;
  etatRecherche: "A_JOUR" | "A_ACTUALISER";
  profils: ProfilPropose[];
  demandesAutresProfils: { le: string; statut: EtatAction["statut"]; commentaire: string | null }[];
};

type DemandeTalent = { id: string; titre: string | null; description: string; statut: string; createdAt: string };

const LABEL_STATUT_DEMANDE: Record<string, string> = {
  SOUMISE: "Transmise",
  ANALYSEE: "En cours d'analyse",
  EN_MATCHING: "Recherche de profils en cours",
  SHORTLIST_ENVOYEE: "Profils proposés",
  CLOTUREE: "Clôturée",
};

const LABEL_CORRESPONDANCE: Record<string, { texte: string; variant: BadgeVariant }> = {
  FORTE: { texte: "Correspondance forte", variant: "success" },
  PARTIELLE: { texte: "Correspondance partielle", variant: "info" },
};

const LABEL_STATUT_ACTION: Record<EtatAction["statut"], string> = {
  ENVOYEE: "transmis à l'équipe ATLAS",
  PRISE_EN_CHARGE: "pris en charge par l'équipe ATLAS",
  CLOTUREE: "traité",
};

function texteAction(a: EtatAction): string {
  const quoi = a.type === "POURSUIVRE" ? "Vous souhaitez poursuivre" : "Profil non retenu";
  return `${quoi} — ${LABEL_STATUT_ACTION[a.statut]} le ${new Date(a.le).toLocaleDateString("fr-FR")}`;
}

// REV-02 (01/11/2026) : la liste s'affiche immédiatement (lecture seule) ;
// les besoins dont la recherche n'est plus à jour sont actualisés ensuite, par
// lots de 5, l'un après l'autre — jamais tous les besoins à chaque visite.
const TAILLE_LOT_ACTUALISATION = 5;
const PROFILS_MAX = 5;

export default function TalentsClientPage() {
  const [suivi, setSuivi] = useState<SuiviBesoin[] | null>(null);
  const [demandes, setDemandes] = useState<DemandeTalent[]>([]);
  const [erreur, setErreur] = useState(false);

  async function actualiser(besoins: SuiviBesoin[]) {
    const aActualiser = besoins.filter((b) => b.eligible && b.etatRecherche === "A_ACTUALISER").map((b) => b.besoinId);
    for (let i = 0; i < aActualiser.length; i += TAILLE_LOT_ACTUALISATION) {
      const lot = aActualiser.slice(i, i + TAILLE_LOT_ACTUALISATION);
      const r = await fetch("/api/client/talents/actualiser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needIds: lot }),
      }).catch(() => null);
      if (!r || !r.ok) return; // les profils déjà affichés restent visibles
      const d = await r.json().catch(() => ({ besoins: [] }));
      const parId = new Map<string, SuiviBesoin>((d.besoins ?? []).map((b: SuiviBesoin) => [b.besoinId, { ...b, etatRecherche: "A_JOUR" as const }]));
      setSuivi((courant) => courant?.map((b) => parId.get(b.besoinId) ?? (lot.includes(b.besoinId) ? { ...b, etatRecherche: "A_JOUR" as const } : b)) ?? courant);
    }
  }

  function charger() {
    setErreur(false);
    fetch("/api/client/talents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const besoins: SuiviBesoin[] = d.besoins ?? [];
        setSuivi(besoins);
        void actualiser(besoins);
      })
      .catch(() => setErreur(true));
    // Historique des demandes Talent déjà transmises (lecture seule) — un
    // échec ici ne bloque jamais l'affichage des profils proposés.
    fetch("/api/talent/demandes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDemandes(Array.isArray(d) ? d : []))
      .catch(() => setDemandes([]));
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <Section title="Profils proposés pour vos besoins">
        <p style={{ color: grisTexte, fontSize: 13, margin: "-4px 0 12px" }}>
          Pour chaque besoin validé, ATLAS vous présente jusqu&apos;à cinq profils réellement admissibles, de façon anonyme.
          Comparez-les, indiquez ceux avec lesquels vous souhaitez poursuivre ou demandez d&apos;autres profils : notre équipe
          prend le relais. Pour exprimer un nouveau besoin, utilisez la rubrique <Link href="/client/besoins">Besoins</Link>.
        </p>
        {erreur && (
          <Card>
            <p role="alert" style={{ margin: 0, fontSize: 13 }}>
              Impossible de charger les profils proposés pour le moment.{" "}
              <Bouton variant="secondary" onClick={charger}>Réessayer</Bouton>
            </p>
          </Card>
        )}
        {!erreur && suivi === null && (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: grisTexte }}>
            Chargement des profils proposés…
          </p>
        )}
        {suivi && suivi.length === 0 && (
          <EmptyState message="Aucun besoin validé pour l'instant. Exprimez puis validez un besoin dans la rubrique Besoins : les profils proposés apparaîtront ici." />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {suivi?.map((b) => <BlocBesoin key={b.besoinId} besoin={b} recharger={charger} />)}
        </div>
      </Section>

      {demandes.length > 0 && (
        <Section title="Demandes transmises à l'équipe ATLAS">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {demandes.map((d) => (
              <Card key={d.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 13 }}>{d.titre ?? d.description.slice(0, 90)}</p>
                  <Badge variant="info">{LABEL_STATUT_DEMANDE[d.statut] ?? "En cours"}</Badge>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>
                  Transmise le {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                </p>
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function BlocBesoin({ besoin, recharger }: { besoin: SuiviBesoin; recharger: () => void }) {
  const [compares, setCompares] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [formAutres, setFormAutres] = useState(false);
  const demandeEnCours = besoin.demandesAutresProfils.find((d) => d.statut !== "CLOTUREE");

  async function agir(type: "POURSUIVRE" | "NE_PAS_RETENIR" | "AUTRES_PROFILS", cible?: ProfilPropose["cible"], cle?: string) {
    setErreur(null);
    setEnvoi(cle ?? type);
    const reponse = await fetch("/api/client/talents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needId: besoin.besoinId, type, ...(cible ?? {}), commentaire: type === "AUTRES_PROFILS" ? commentaire : undefined }),
    });
    setEnvoi(null);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(data.error ?? "Une erreur est survenue.");
      return;
    }
    setCommentaire("");
    setFormAutres(false);
    recharger();
  }

  function basculerComparaison(cle: string) {
    setCompares((prev) => (prev.includes(cle) ? prev.filter((c) => c !== cle) : prev.length >= 5 ? prev : [...prev, cle]));
  }

  const profilsCompares = besoin.profils.filter((p) => compares.includes(p.cle));

  return (
    <section id={`besoin-${besoin.besoinId}`} aria-label={`Besoin : ${besoin.titre}`}>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{besoin.titre}</h3>
        <span style={{ fontSize: 12, color: grisTexte }}>
          {besoin.profils.length} profil{besoin.profils.length > 1 ? "s" : ""} proposé{besoin.profils.length > 1 ? "s" : ""} sur {PROFILS_MAX} au plus
        </span>
      </div>

      {besoin.eligible && besoin.etatRecherche === "A_ACTUALISER" && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: grisTexte, margin: "6px 0 0" }}>
          Vos critères ou les profils disponibles ont évolué : recherche de profils en cours…
        </p>
      )}

      {erreur && <p role="alert" style={{ color: "#c0392b", fontSize: 12, margin: "8px 0 0" }}>{erreur}</p>}

      {!besoin.eligible && besoin.raison && <p style={{ fontSize: 13, color: grisTexte }}>{besoin.raison}</p>}

      {besoin.eligible && besoin.profils.length === 0 && besoin.etatRecherche === "A_JOUR" && (
        <p style={{ fontSize: 13, color: grisTexte, margin: "8px 0" }}>
          Aucun profil ne couvre aujourd&apos;hui vos critères avec des compétences vérifiées. Nous ne vous présentons que des profils
          réellement admissibles : demandez d&apos;autres profils pour que notre équipe élargisse la recherche.
        </p>
      )}

      {besoin.profils.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {besoin.profils.map((p) => (
            <li key={p.cle} style={{ border: `1px solid ${bordure}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <strong style={{ fontSize: 14 }}>{p.libelle}</strong>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {p.recommande && <Badge variant="success">Recommandé</Badge>}
                  {p.niveauCorrespondance && <Badge variant={LABEL_CORRESPONDANCE[p.niveauCorrespondance].variant}>{LABEL_CORRESPONDANCE[p.niveauCorrespondance].texte}</Badge>}
                  {p.origine === "EQUIPE_ATLAS" && <Badge variant="info">Sélectionné par l&apos;équipe ATLAS</Badge>}
                </span>
              </div>
              {(p.seniorite || p.anneesExperience !== null) && (
                <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>
                  {[p.seniorite, p.anneesExperience !== null ? `${p.anneesExperience} ans d'expérience` : null].filter(Boolean).join(" · ")}
                </p>
              )}
              <p style={{ margin: 0, fontSize: 12 }}>
                <span style={{ color: grisTexte }}>Compétences vérifiées : </span>
                {p.competencesCorrespondantes.length > 0 ? p.competencesCorrespondantes.join(", ") : "—"}
              </p>
              {p.competencesManquantes.length > 0 && (
                <p style={{ margin: 0, fontSize: 12 }}>
                  <span style={{ color: grisTexte }}>Non couvertes : </span>
                  {p.competencesManquantes.join(", ")}
                </p>
              )}
              <p style={{ margin: 0, fontSize: 12 }}>
                <span style={{ color: grisTexte }}>Disponibilité : </span>
                {p.disponibilite ?? "à confirmer"}
              </p>
              {p.criteresAPreciser.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>À confirmer : {p.criteresAPreciser.join(" ; ")}</p>
              )}
              {p.derniereAction && (
                <p role="status" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{texteAction(p.derniereAction)}</p>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 4 }}>
                <Bouton
                  onClick={() => agir("POURSUIVRE", p.cible, p.cle)}
                  disabled={envoi === p.cle || (p.derniereAction !== null && p.derniereAction.statut !== "CLOTUREE")}
                  aria-label={`Je souhaite poursuivre avec le ${p.libelle}`}
                >
                  Je souhaite poursuivre
                </Bouton>
                <Bouton
                  variant="secondary"
                  onClick={() => agir("NE_PAS_RETENIR", p.cible, p.cle)}
                  disabled={envoi === p.cle || (p.derniereAction !== null && p.derniereAction.statut !== "CLOTUREE")}
                  aria-label={`Ne pas retenir le ${p.libelle}`}
                >
                  Ne pas retenir
                </Bouton>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: grisTexte }}>
                  <input
                    type="checkbox"
                    checked={compares.includes(p.cle)}
                    onChange={() => basculerComparaison(p.cle)}
                    disabled={!compares.includes(p.cle) && compares.length >= 5}
                  />
                  Comparer
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      {profilsCompares.length >= 2 && <Comparaison profils={profilsCompares} />}
      {profilsCompares.length === 1 && (
        <p style={{ fontSize: 12, color: grisTexte, margin: "8px 0 0" }}>Cochez au moins un autre profil pour les comparer côte à côte.</p>
      )}

      <div style={{ marginTop: 14, borderTop: `1px solid ${bordure}`, paddingTop: 10 }}>
        {demandeEnCours ? (
          <p role="status" style={{ margin: 0, fontSize: 13 }}>
            Demande de profils supplémentaires {LABEL_STATUT_ACTION[demandeEnCours.statut]} le{" "}
            {new Date(demandeEnCours.le).toLocaleDateString("fr-FR")}.
          </p>
        ) : formAutres ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: grisTexte }}>
              Précisez si besoin ce qui manque aux profils proposés (facultatif)
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                maxLength={1000}
                rows={3}
                style={{ display: "block", width: "100%", marginTop: 4, padding: 8, borderRadius: 6, fontFamily: "inherit" }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Bouton onClick={() => agir("AUTRES_PROFILS")} disabled={envoi === "AUTRES_PROFILS"}>
                Envoyer la demande
              </Bouton>
              <Bouton variant="secondary" onClick={() => setFormAutres(false)}>
                Annuler
              </Bouton>
            </div>
          </div>
        ) : (
          <Bouton variant="secondary" onClick={() => setFormAutres(true)}>
            Demander d&apos;autres profils
          </Bouton>
        )}
      </div>
    </Card>
    </section>
  );
}

function Comparaison({ profils }: { profils: ProfilPropose[] }) {
  const lignes: { libelle: string; valeur: (p: ProfilPropose) => string }[] = [
    { libelle: "Correspondance", valeur: (p) => (p.niveauCorrespondance ? LABEL_CORRESPONDANCE[p.niveauCorrespondance].texte : "Sélection de l'équipe") },
    { libelle: "Compétences vérifiées", valeur: (p) => p.competencesCorrespondantes.join(", ") || "—" },
    { libelle: "Non couvertes", valeur: (p) => p.competencesManquantes.join(", ") || "—" },
    { libelle: "Séniorité", valeur: (p) => p.seniorite ?? "—" },
    { libelle: "Expérience", valeur: (p) => (p.anneesExperience !== null ? `${p.anneesExperience} ans` : "—") },
    { libelle: "Disponibilité", valeur: (p) => p.disponibilite ?? "à confirmer" },
    { libelle: "À confirmer", valeur: (p) => p.criteresAPreciser.join(" ; ") || "—" },
  ];
  return (
    <div style={{ marginTop: 14, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 320 }}>
        <caption style={{ textAlign: "left", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Comparaison des profils sélectionnés</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left", padding: 6, color: grisTexte }}>Critère</th>
            {profils.map((p) => (
              <th key={p.cle} scope="col" style={{ textAlign: "left", padding: 6 }}>{p.libelle}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.libelle} style={{ borderTop: `1px solid ${bordure}` }}>
              <th scope="row" style={{ textAlign: "left", padding: 6, color: grisTexte, fontWeight: 500 }}>{l.libelle}</th>
              {profils.map((p) => (
                <td key={p.cle} style={{ padding: 6, verticalAlign: "top" }}>{l.valeur(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
