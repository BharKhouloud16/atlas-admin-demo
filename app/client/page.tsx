"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { grisTexte, bleu } from "@/lib/theme";
import { Card, Section, EmptyState, Badge } from "@/components/client/primitives";
import type { FeuilleClient } from "@/components/client/FeuillesATraiter";
import type { MissionEvaluable } from "@/components/client/EvaluationsAFaire";

// COMPANY ATLAS — LOT 1 : Client Workspace Foundation (15/09/2026).
//
// Remplace l'ancien dashboard (4 listes empilées sans hiérarchie) par une
// véritable Vue d'ensemble : les mêmes données déjà servies par les mêmes
// routes existantes (GET /api/client/missions, /api/client/documents,
// /api/feuilles-de-temps, /api/evaluations, /api/talent/demandes — AUCUNE
// nouvelle route), réorganisées par priorité (directive de l'ordre, section
// 4) : 1. Actions requises, 2. En cours, 3. Activité récente, 4. Documents
// importants, 5. Résultats (teaser). Aucun agrégat calculé n'est présenté
// comme une métrique officielle — seulement des comptages directs des
// mêmes listes.

type Mission = { id: string; repere: string | null; statut: string; nbJours: number; createdAt: string; profil: { nom: string } };
type DocumentClient = { id: string; titre: string; type: string; createdAt: string };
type DemandeTalent = { id: string; titre: string | null; description: string; statut: string; createdAt: string };

type ActiviteItem = { id: string; date: string; label: string; href: string };

export default function VueDEnsembleClient() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [documents, setDocuments] = useState<DocumentClient[]>([]);
  const [feuilles, setFeuilles] = useState<FeuilleClient[]>([]);
  const [evaluables, setEvaluables] = useState<MissionEvaluable[]>([]);
  const [demandes, setDemandes] = useState<DemandeTalent[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/client/missions").then((r) => r.json()),
      fetch("/api/client/documents").then((r) => r.json()),
      fetch("/api/feuilles-de-temps").then((r) => r.json()),
      fetch("/api/evaluations").then((r) => r.json()),
      fetch("/api/talent/demandes").then((r) => r.json()),
    ]).then(([m, d, f, ev, dem]) => {
      setMissions(m ?? []);
      setDocuments(Array.isArray(d) ? d : []);
      setFeuilles(f.feuilles ?? []);
      setEvaluables(ev.missions ?? []);
      setDemandes(Array.isArray(dem) ? dem : []);
      setChargement(false);
    });
  }, []);

  const feuillesAValider = feuilles.filter((f) => f.statut === "ValideeAdmin");
  const missionsAEvaluer = evaluables.filter((m) => !m.evaluation);
  const totalActions = feuillesAValider.length + missionsAEvaluer.length;

  const missionsEnCours = missions.filter((m) => m.statut === "En cours");
  const demandesEnCours = demandes.filter((d) => d.statut !== "CLOTUREE");

  const activite: ActiviteItem[] = [
    ...missions.map((m) => ({ id: `m-${m.id}`, date: m.createdAt, label: `Mission démarrée — ${m.repere ?? m.profil.nom}`, href: "/client/missions" })),
    ...documents.map((d) => ({ id: `d-${d.id}`, date: d.createdAt, label: `Nouveau document — ${d.titre}`, href: "/client/documents" })),
    ...demandes.map((d) => ({ id: `t-${d.id}`, date: d.createdAt, label: `Demande talent — ${d.titre ?? d.description.slice(0, 40)}`, href: "/client/talent" })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  if (chargement) return <EmptyState message="Chargement…" />;

  return (
    <div>
      <Section title="Actions requises">
        {totalActions === 0 ? (
          <EmptyState message="Rien ne requiert votre attention pour l'instant." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {feuillesAValider.length > 0 && (
              <Link href="/client/finance" style={{ textDecoration: "none" }}>
                <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, color: "#111" }}>
                    {feuillesAValider.length} feuille{feuillesAValider.length > 1 ? "s" : ""} de temps à valider
                  </p>
                  <Badge variant="warning">À traiter</Badge>
                </Card>
              </Link>
            )}
            {missionsAEvaluer.length > 0 && (
              <Link href="/client/missions" style={{ textDecoration: "none" }}>
                <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, color: "#111" }}>
                    {missionsAEvaluer.length} mission{missionsAEvaluer.length > 1 ? "s" : ""} terminée{missionsAEvaluer.length > 1 ? "s" : ""} à évaluer
                  </p>
                  <Badge variant="warning">À traiter</Badge>
                </Card>
              </Link>
            )}
          </div>
        )}
      </Section>

      <Section title="En cours" action={<Link href="/client/missions" style={{ fontSize: 12, color: bleu, textDecoration: "none", fontWeight: 600 }}>Voir tout</Link>}>
        {missionsEnCours.length === 0 && demandesEnCours.length === 0 ? (
          <EmptyState message="Aucune mission ni demande en cours." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {missionsEnCours.slice(0, 3).map((m) => (
              <Card key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{m.repere ?? m.profil.nom}</p>
                <Badge variant="info">{m.nbJours} j</Badge>
              </Card>
            ))}
            {demandesEnCours.slice(0, 2).map((d) => (
              <Card key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{d.titre ?? d.description.slice(0, 50)}</p>
                <Badge variant="neutral">{d.statut}</Badge>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Activité récente">
        {activite.length === 0 ? (
          <EmptyState message="Aucune activité récente." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {activite.map((a) => (
              <Link key={a.id} href={a.href} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                  <span>{a.label}</span>
                  <span style={{ color: grisTexte, whiteSpace: "nowrap" }}>{new Date(a.date).toLocaleDateString("fr-FR")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="Documents importants" action={<Link href="/client/documents" style={{ fontSize: 12, color: bleu, textDecoration: "none", fontWeight: 600 }}>Voir tout</Link>}>
        {documents.length === 0 ? (
          <EmptyState message="Aucun document disponible pour l'instant." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {documents.slice(0, 3).map((d) => (
              <Card key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{d.titre}</p>
                <Badge variant="neutral">{d.type}</Badge>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Résultats" action={<Link href="/client/resultats" style={{ fontSize: 12, color: bleu, textDecoration: "none", fontWeight: 600 }}>Voir tout</Link>}>
        {evaluables.filter((m) => m.evaluation).length === 0 ? (
          <EmptyState message="Aucune mission évaluée pour l'instant." />
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>
            {evaluables.filter((m) => m.evaluation).length} mission{evaluables.filter((m) => m.evaluation).length > 1 ? "s" : ""} terminée{evaluables.filter((m) => m.evaluation).length > 1 ? "s" : ""} évaluée{evaluables.filter((m) => m.evaluation).length > 1 ? "s" : ""} — détail dans la rubrique Résultats.
          </p>
        )}
      </Section>
    </div>
  );
}
