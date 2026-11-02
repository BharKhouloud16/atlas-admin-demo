"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bleuFonce, bordure, grisTexte } from "@/lib/theme";
import { Card, Badge, Bouton, type BadgeVariant } from "@/components/client/primitives";
import type { TableauDeBord, TacheAFaire, Bloc } from "@/lib/client-dashboard/tableau-de-bord";
import { LIBELLE_ETAT_ATLAS_OS } from "@/lib/atlas-os/etats";
import { Icone, type NomIcone } from "@/components/client/Icones";

// LOT 4 (28/10/2026) — Vue d'ensemble du Client, centre de pilotage.
//
// Un seul appel (/api/client/tableau-de-bord), agrégé côté serveur bloc par
// bloc : un bloc en erreur n'empêche jamais l'affichage des autres, un délai
// maximal évite tout « Chargement… » infini (registre OBS-03), les statuts
// sont traduits en libellés métier (OBS-04). Tous les chiffres sont ceux du
// client connecté : aucune donnée d'exemple, aucune actualité inventée.

const DELAI_MAX_MS = 15_000;

const PRIORITE: Record<TacheAFaire["priorite"], { texte: string; variant: BadgeVariant }> = {
  OBLIGATOIRE: { texte: "Obligatoire", variant: "error" },
  PRIORITAIRE: { texte: "Prioritaire", variant: "warning" },
  A_COMPLETER: { texte: "À compléter", variant: "info" },
  INFORMATION: { texte: "Information", variant: "neutral" },
};

const VARIANT_ATLAS_OS: Record<string, BadgeVariant> = { DISPONIBLE: "info", EN_ATTENTE: "warning", ACTIVE: "success", INDISPONIBLE: "neutral" };

export default function VueDEnsembleClient() {
  const [tableau, setTableau] = useState<TableauDeBord | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(() => {
    setChargement(true);
    setErreur(null);
    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), DELAI_MAX_MS);
    fetch("/api/client/tableau-de-bord", { cache: "no-store", signal: controleur.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TableauDeBord) => setTableau(d))
      .catch((e: Error) =>
        setErreur(e.name === "AbortError" ? "Le chargement prend plus de temps que prévu." : "Impossible de charger votre tableau de bord pour le moment.")
      )
      .finally(() => {
        clearTimeout(minuterie);
        setChargement(false);
      });
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  if (chargement && !tableau) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: grisTexte }}>
        Chargement de votre tableau de bord…
      </p>
    );
  }

  if (!tableau) {
    return (
      <Card>
        <p role="alert" style={{ margin: 0, fontSize: 13 }}>
          {erreur} <Bouton variant="secondary" onClick={charger}>Réessayer</Bouton>
        </p>
      </Card>
    );
  }

  const nom = tableau.client.ok ? tableau.client.donnees.nom : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 22, color: bleuFonce }}>{nom ? `Bonjour, ${nom}` : "Bonjour"}</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: grisTexte }}>Voici un aperçu de votre activité et de vos actions prioritaires.</p>
      </header>

      <Compteurs bloc={tableau.compteurs} recharger={charger} />

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <TravailAFaire bloc={tableau.travailAFaire} recharger={charger} />
        <ActiviteRecente bloc={tableau.activite} recharger={charger} />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "stretch" }}>
        <CarteAtlasOs bloc={tableau.atlasOs} recharger={charger} />
        <Card>
          <h2 style={styleTitreCarte}>Actualités et veille</h2>
          <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>
            Bientôt disponible : une veille réglementaire sourcée et datée, utile à vos besoins et à vos missions. Aucune actualité
            n&apos;est affichée tant que ce service n&apos;est pas opérationnel.
          </p>
        </Card>
        <CarteProfilEntreprise bloc={tableau.completude} recharger={charger} />
      </div>
    </div>
  );
}

const styleTitreCarte = { margin: "0 0 8px", fontSize: 15, color: bleuFonce } as const;

function BlocIndisponible({ titre, recharger }: { titre: string; recharger: () => void }) {
  return (
    <p role="alert" style={{ margin: 0, fontSize: 13, color: grisTexte }}>
      {titre} momentanément indisponible. <Bouton variant="tertiary" onClick={recharger}>Réessayer</Bouton>
    </p>
  );
}

// LOT 7 (01/11/2026, planche) : indicateurs avec pictogramme et précision
// calculée sur les données réelles du client (jamais d'exemple).
function Compteurs({ bloc, recharger }: { bloc: TableauDeBord["compteurs"]; recharger: () => void }) {
  if (!bloc.ok) return <Card><BlocIndisponible titre="Les indicateurs sont" recharger={recharger} /></Card>;
  const c = bloc.donnees;
  const cartes: { libelle: string; valeur: number; precision: string; icone: NomIcone; teinte: string; href: string }[] = [
    { libelle: "Besoins en cours", valeur: c.besoinsEnCours, precision: c.besoinsCetteSemaine > 0 ? `+${c.besoinsCetteSemaine} cette semaine` : "Soumis, à préciser ou validés", icone: "besoins", teinte: "#2557d6", href: "/client/besoins" },
    { libelle: "Besoins en attente", valeur: c.besoinsAPreciser, precision: c.besoinsAPreciser > 0 ? "À préciser par vous" : "Aucun à préciser", icone: "taches", teinte: "#d97706", href: "/client/besoins" },
    { libelle: "Talents proposés", valeur: c.propositionsAExaminer, precision: "À examiner", icone: "talents", teinte: "#6d4fd6", href: "/client/talent" },
    { libelle: "Projets en cours", valeur: c.projetsEnCours, precision: "De la qualification à la livraison", icone: "projets", teinte: "#0f7c8c", href: "/client/projets" },
    { libelle: "Missions en cours", valeur: c.missionsActives, precision: "En cours", icone: "missions", teinte: "#1a7f4b", href: "/client/missions" },
    { libelle: "Actions à faire", valeur: c.actionsAFaire, precision: c.actionsPrioritaires > 0 ? `${c.actionsPrioritaires} prioritaire${c.actionsPrioritaires > 1 ? "s" : ""}` : "Aucune prioritaire", icone: "notifications", teinte: "#c0392b", href: "#travail-a-faire" },
  ];
  return (
    <ul aria-label="Indicateurs" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {cartes.map((k) => (
        <li key={k.libelle}>
          <Link href={k.href} style={{ textDecoration: "none", color: "inherit", display: "block", height: "100%" }}>
            <Card style={{ height: "100%", boxSizing: "border-box" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${k.teinte}1a`, color: k.teinte }}>
                  <Icone nom={k.icone} taille={16} />
                </span>
                <span style={{ fontSize: 12, color: grisTexte }}>{k.libelle}</span>
              </span>
              <p style={{ margin: "8px 0 2px", fontSize: 26, fontWeight: 700, color: bleuFonce }} aria-label={`${k.libelle} : ${k.valeur}`}>
                {k.valeur}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: k.teinte, fontWeight: 600 }}>{k.precision}</p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const TACHES_VISIBLES = 6;

function TravailAFaire({ bloc, recharger }: { bloc: TableauDeBord["travailAFaire"]; recharger: () => void }) {
  const [toutes, setToutes] = useState(false);
  const liste = bloc.ok ? (toutes ? bloc.donnees : bloc.donnees.slice(0, TACHES_VISIBLES)) : [];
  const restantes = bloc.ok ? bloc.donnees.length - TACHES_VISIBLES : 0;
  return (
    <section id="travail-a-faire" aria-labelledby="titre-travail">
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 id="titre-travail" style={styleTitreCarte}>Travail à faire</h2>
          <Link href="/client/attentions" style={{ fontSize: 12, color: bleu, textDecoration: "none", fontWeight: 600 }}>Voir tout</Link>
        </div>
        {!bloc.ok ? (
          <BlocIndisponible titre="La liste des actions est" recharger={recharger} />
        ) : bloc.donnees.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>Rien ne requiert votre attention pour l&apos;instant.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {liste.map((t) => (
              <li key={t.id} style={{ borderTop: `1px solid ${bordure}` }}>
                <Link href={t.href} style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", padding: "10px 0", textDecoration: "none", color: "inherit" }}>
                  <span>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111" }}>{t.titre}</span>
                    <span style={{ display: "block", fontSize: 12, color: grisTexte }}>{t.detail}</span>
                  </span>
                  <Badge variant={PRIORITE[t.priorite].variant}>{PRIORITE[t.priorite].texte}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {bloc.ok && restantes > 0 && (
          <Bouton variant="tertiary" onClick={() => setToutes(!toutes)} aria-expanded={toutes}>
            {toutes ? "Afficher moins" : `Afficher les ${restantes} autre${restantes > 1 ? "s" : ""} action${restantes > 1 ? "s" : ""}`}
          </Bouton>
        )}
      </Card>
    </section>
  );
}

function ActiviteRecente({ bloc, recharger }: { bloc: TableauDeBord["activite"]; recharger: () => void }) {
  return (
    <section aria-labelledby="titre-activite">
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 id="titre-activite" style={styleTitreCarte}>Activité récente</h2>
          <Link href="/client/attentions" style={{ fontSize: 12, color: bleu, textDecoration: "none", fontWeight: 600 }}>Voir tout</Link>
        </div>
        {!bloc.ok ? (
          <BlocIndisponible titre="L'activité récente est" recharger={recharger} />
        ) : bloc.donnees.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>Aucune activité pour l&apos;instant.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {bloc.donnees.map((e) => (
              <li key={e.id} style={{ borderTop: `1px solid ${bordure}` }}>
                <Link href={e.href} style={{ display: "flex", gap: 10, justifyContent: "space-between", padding: "8px 0", textDecoration: "none", color: "inherit", fontSize: 13 }}>
                  <span>
                    {e.libelle}
                    {e.detail && <span style={{ display: "block", fontSize: 12, color: grisTexte }}>{e.detail}</span>}
                  </span>
                  <time dateTime={e.date} style={{ color: grisTexte, whiteSpace: "nowrap", fontSize: 12 }}>{new Date(e.date).toLocaleDateString("fr-FR")}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function CarteAtlasOs({ bloc, recharger }: { bloc: TableauDeBord["atlasOs"]; recharger: () => void }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ ...styleTitreCarte, display: "flex", alignItems: "center", gap: 8 }}>
          ATLAS OS
          {bloc.ok && bloc.donnees.etat !== "ACTIVE" && <Badge variant="info">Option</Badge>}
        </h2>
        {bloc.ok && <Badge variant={VARIANT_ATLAS_OS[bloc.donnees.etat]}>{LIBELLE_ETAT_ATLAS_OS[bloc.donnees.etat]}</Badge>}
      </div>
      {!bloc.ok ? (
        <BlocIndisponible titre="L'état d'ATLAS OS est" recharger={recharger} />
      ) : (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: grisTexte }}>
            Module optionnel : prestations QA, sécurité et audit pilotées par ATLAS, activées à votre demande.
          </p>
          <Link
            href="/client/atlas-os"
            style={{ display: "inline-block", fontSize: 13, fontWeight: 600, textDecoration: "none", ...(bloc.donnees.etat === "DISPONIBLE" ? { color: "#fff", background: bleuFonce, padding: "8px 14px", borderRadius: 8 } : { color: bleu }) }}
          >
            {bloc.donnees.etat === "ACTIVE" ? "Ouvrir ATLAS OS →" : bloc.donnees.etat === "DISPONIBLE" ? "Découvrir et activer" : "Voir le détail →"}
          </Link>
        </>
      )}
    </Card>
  );
}

function CarteProfilEntreprise({ bloc, recharger }: { bloc: Bloc<{ etapes: { etape: string; libelle: string; complete: boolean; manquants: string[] }[]; prochaineEtape: string | null; pourcentage: number }>; recharger: () => void }) {
  return (
    <Card>
      <h2 style={styleTitreCarte}>Profil entreprise</h2>
      {!bloc.ok ? (
        <BlocIndisponible titre="L'état du profil est" recharger={recharger} />
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, color: bleu, fontWeight: 600 }}>{bloc.donnees.pourcentage} % complété</p>
          <div
            role="progressbar"
            aria-label="Avancement du profil entreprise"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bloc.donnees.pourcentage}
            style={{ height: 6, borderRadius: 999, background: "#e9edf5", margin: "8px 0 10px", overflow: "hidden" }}
          >
            <div style={{ width: `${bloc.donnees.pourcentage}%`, height: "100%", background: bleu }} />
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 4 }}>
            {bloc.donnees.etapes
              .filter((e) => e.etape !== "COMPTE")
              .map((e) => (
                <li key={e.etape} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                  <Badge variant={e.complete ? "success" : "warning"}>{e.complete ? "Prêt" : "À compléter"}</Badge>
                  {e.libelle}
                </li>
              ))}
          </ul>
          <Link
            href="/client/profil#entreprise"
            style={{ display: "block", textAlign: "center", fontSize: 13, color: bleuFonce, fontWeight: 600, textDecoration: "none", border: `1px solid ${bordure}`, borderRadius: 8, padding: "8px 12px" }}
          >
            {bloc.donnees.pourcentage < 100 ? "Compléter mon profil" : "Voir mon profil"}
          </Link>
        </>
      )}
    </Card>
  );
}
