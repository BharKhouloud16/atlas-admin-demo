"use client";

import { useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import type { Realisation } from "@/app/api/ingenieur/realisations/route";
import type { BadgeConfiance } from "@/lib/scoring";
import { Card, Section, EmptyState, Bouton, Badge } from "@/components/client/primitives";
import EvaluationsAFaire, { type MissionEvaluable } from "@/components/client/EvaluationsAFaire";
import MissionOutcomeSection from "./MissionOutcomeSection";

// LOT 1 — Client Workspace Foundation (15/09/2026) : rubrique "Missions",
// extraite de l'ancien dashboard (app/client/page.tsx) — même appel API
// (GET /api/client/missions, inchangé), même contenu vitrine (portfolio,
// badge, vidéo — jamais TJM ni score de matching, cf. le commentaire de
// cette route). L'évaluation d'une mission terminée (POST /api/evaluations)
// est rattachée ici plutôt que restée sur le dashboard : elle porte
// toujours sur une mission précise.

type ProfilVitrine = {
  id: string;
  nom: string;
  prenom: string | null;
  realisations: Realisation[] | null;
  badge: BadgeConfiance;
};

type SourceDemande = { id: string; titre: string | null };

type Mission = {
  id: string;
  repere: string | null;
  statut: string;
  nbJours: number;
  createdAt: string;
  dateDebut: string | null;
  dateFin: string | null;
  modeTravail: string | null;
  sourceDemande: SourceDemande | null;
  profil: ProfilVitrine;
};

export default function MissionsClientPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [chargement, setChargement] = useState(true);
  const [missionsEvaluables, setMissionsEvaluables] = useState<MissionEvaluable[]>([]);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  // DB-08 — Outcome UI : état séparé de `ouvertes` (vitrine du profil),
  // même discipline que app/admin/missions/page.tsx (outcomeOuvert distinct
  // de revueOuverte) — ne jamais fusionner deux panneaux sans rapport dans
  // un seul état.
  const [outcomesOuverts, setOutcomesOuverts] = useState<Set<string>>(new Set());

  function basculer(id: string) {
    setOuvertes((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  function basculerOutcome(id: string) {
    setOutcomesOuverts((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  function rechargerEvaluations() {
    fetch("/api/evaluations").then((r) => r.json()).then((d) => setMissionsEvaluables(d.missions ?? []));
  }

  useEffect(() => {
    fetch("/api/client/missions")
      .then((r) => r.json())
      .then((d) => {
        setMissions(d);
        setChargement(false);
      });
    rechargerEvaluations();
  }, []);

  const aEvaluer = missionsEvaluables.some((m) => !m.evaluation);

  return (
    <div>
      {aEvaluer && (
        <Section title="Missions terminées à évaluer">
          <EvaluationsAFaire missions={missionsEvaluables} recharger={rechargerEvaluations} />
        </Section>
      )}

      <Section title="Vos missions">
        {chargement && <EmptyState message="Chargement…" />}
        {!chargement && missions.length === 0 && <EmptyState message="Aucune mission pour l'instant." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {missions.map((m) => {
            const ouverte = ouvertes.has(m.id);
            const aVitrine = (m.profil.realisations?.length ?? 0) > 0 || Boolean(m.profil.badge);
            return (
              <Card key={m.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{m.repere ?? m.profil.nom}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 13, color: grisTexte }}>
                      Statut : {m.statut} · {m.nbJours} jour(s) · démarrée le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                    {(m.dateDebut || m.modeTravail) && (
                      <p style={{ margin: "3px 0 0", fontSize: 13, color: grisTexte }}>
                        {m.dateDebut && <>Début : {new Date(m.dateDebut).toLocaleDateString("fr-FR")}</>}
                        {m.dateDebut && m.dateFin && " · "}
                        {m.dateFin && <>Fin : {new Date(m.dateFin).toLocaleDateString("fr-FR")}</>}
                        {(m.dateDebut || m.dateFin) && m.modeTravail && " · "}
                        {m.modeTravail && <>Mode : {m.modeTravail}</>}
                      </p>
                    )}
                    {m.sourceDemande && (
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "#94a0b3" }}>
                        Issue du besoin : {m.sourceDemande.titre ?? "(sans titre)"}
                      </p>
                    )}
                    {m.profil.badge && (
                      <div style={{ marginTop: 6 }}>
                        <Badge variant="info">
                          {m.profil.badge.niveau === "confirme" ? "★ " : ""}
                          {m.profil.badge.label}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {aVitrine && (
                      <Bouton variant="secondary" onClick={() => basculer(m.id)}>
                        {ouverte ? "Masquer le profil" : "Voir le profil"}
                      </Bouton>
                    )}
                    {/* DB-08 — Outcome UI : affiché uniquement une fois la
                        mission TERMINEE (seul état où le backend autorise la
                        création d'un Outcome, A6.1 — avant cela la lecture
                        renverrait toujours outcome=null) — même gating que
                        le bouton "Résultat attendu (Outcome)" côté Admin
                        (app/admin/missions/page.tsx). */}
                    {m.statut === "TERMINEE" && (
                      <Bouton variant="secondary" onClick={() => basculerOutcome(m.id)}>
                        {outcomesOuverts.has(m.id) ? "Masquer le résultat" : "Voir le résultat"}
                      </Bouton>
                    )}
                  </div>
                </div>
                {ouverte && <ProfilVitrineDetail profil={m.profil} />}
                {outcomesOuverts.has(m.id) && <MissionOutcomeSection missionId={m.id} />}
              </Card>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// Aperçu "vitrine" du profil de l'ingénieur, côté client : portfolio de
// réalisations, en lecture seule — jamais de score de matching ni de TJM
// (réservés à l'Admin, voir /api/client/missions).
// Reprise à l'identique de l'ancien app/client/page.tsx.
function ProfilVitrineDetail({ profil }: { profil: ProfilVitrine }) {
  const realisations = profil.realisations ?? [];

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Réalisations</p>
        {realisations.length === 0 ? (
          <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>Aucune réalisation renseignée pour l&apos;instant.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {realisations.map((r) => (
              <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{r.titre}</p>
                {r.description && <p style={{ margin: "3px 0 0", fontSize: 12, color: "#666" }}>{r.description}</p>}
                {r.lien && (
                  <a href={r.lien} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    {r.lien}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
