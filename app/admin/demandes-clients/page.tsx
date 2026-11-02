"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { bordure, grisTexte, orange, rouge, vert, bleu } from "@/lib/theme";

// REV (01/11/2026) — « Demandes clients » : tout ce que les Clients ont
// demandé à l'équipe ATLAS (Talents, Projets, ATLAS OS), au même endroit,
// les plus anciennes d'abord. Prise en charge et clôture ici ; les décisions
// métier (confirmer un engagement, activer ATLAS OS, créer une mission) se
// font sur la page dédiée, ouverte par le lien de chaque demande.

type Demande = {
  cle: string;
  source: "TALENT" | "PROJET" | "ENGAGEMENT" | "ATLAS_OS";
  id: string;
  type: string;
  libelle: string;
  client: { id: string; nom: string };
  objet: { titre: string; href: string };
  detail: string | null;
  statut: "ENVOYEE" | "PRISE_EN_CHARGE" | "CLOTUREE";
  traitableIci: boolean;
  creeLe: string;
  traiteLe: string | null;
  traiteParEmail: string | null;
};

const SOURCES: Record<Demande["source"], string> = { TALENT: "Talents", PROJET: "Projets", ENGAGEMENT: "Projets", ATLAS_OS: "ATLAS OS" };
const BOUTON = { fontSize: 12, padding: "5px 10px", borderRadius: 6 } as const;
const BOUTON_SECONDAIRE = { ...BOUTON, background: "#fff", color: "#12224a", border: `1px solid ${bordure}` } as const;

const STATUTS: Record<Demande["statut"], { texte: string; couleur: string }> = {
  ENVOYEE: { texte: "À traiter", couleur: orange },
  PRISE_EN_CHARGE: { texte: "Prise en charge", couleur: bleu },
  CLOTUREE: { texte: "Clôturée", couleur: vert },
};

export default function DemandesClientsPage() {
  const [vue, setVue] = useState<"OUVERTES" | "CLOTUREES">("OUVERTES");
  const [source, setSource] = useState<"TOUTES" | "Talents" | "Projets" | "ATLAS OS">("TOUTES");
  const [demandes, setDemandes] = useState<Demande[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  function charger(v = vue) {
    setErreur(null);
    setDemandes(null);
    fetch(`/api/admin/demandes-clients?statut=${v}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setDemandes(d.demandes ?? []))
      .catch(() => setErreur("Impossible de charger les demandes clients."));
  }
  useEffect(() => charger(vue), [vue]); // eslint-disable-line react-hooks/exhaustive-deps

  async function traiter(d: Demande, statut: "PRISE_EN_CHARGE" | "CLOTUREE") {
    setErreur(null);
    setEnvoi(d.cle);
    const r = await fetch(`/api/admin/demandes-clients/${d.source}/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut }),
    }).catch(() => null);
    setEnvoi(null);
    if (!r || !r.ok) {
      const corps = r ? await r.json().catch(() => ({})) : {};
      setErreur(corps.error ?? "L'opération n'a pas pu être effectuée.");
      return;
    }
    charger();
  }

  const affichees = useMemo(() => (demandes ?? []).filter((d) => source === "TOUTES" || SOURCES[d.source] === source), [demandes, source]);
  const aTraiter = (demandes ?? []).filter((d) => d.statut === "ENVOYEE").length;

  return (
    <div>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Demandes clients</h1>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: grisTexte }}>
        Profils à poursuivre, demandes d&apos;autres profils, questions sur une proposition, engagements à confirmer et activations ATLAS OS.
        Les plus anciennes en premier.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div role="group" aria-label="Statut des demandes" style={{ display: "flex", gap: 6 }}>
          {(["OUVERTES", "CLOTUREES"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={vue === v} onClick={() => setVue(v)} style={vue === v ? BOUTON : BOUTON_SECONDAIRE}>
              {v === "OUVERTES" ? "En cours" : "Clôturées"}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 13 }}>
          Origine{" "}
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="TOUTES">Toutes</option>
            <option value="Talents">Talents</option>
            <option value="Projets">Projets</option>
            <option value="ATLAS OS">ATLAS OS</option>
          </select>
        </label>
        {vue === "OUVERTES" && demandes && (
          <span role="status" style={{ fontSize: 13, color: grisTexte }}>
            {aTraiter} demande{aTraiter > 1 ? "s" : ""} à traiter
          </span>
        )}
      </div>

      {erreur && (
        <p role="alert" style={{ color: rouge, fontSize: 13 }}>
          {erreur}
        </p>
      )}
      {!erreur && demandes === null && <p role="status" style={{ fontSize: 13, color: grisTexte }}>Chargement…</p>}
      {demandes && affichees.length === 0 && <p style={{ fontSize: 13, color: grisTexte }}>Aucune demande {vue === "OUVERTES" ? "en cours" : "clôturée"}.</p>}

      {affichees.length > 0 && (
        <table aria-label="Demandes clients" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: 6 }}>Reçue le</th>
              <th style={{ padding: 6 }}>Client</th>
              <th style={{ padding: 6 }}>Demande</th>
              <th style={{ padding: 6 }}>Objet</th>
              <th style={{ padding: 6 }}>Statut</th>
              <th style={{ padding: 6 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {affichees.map((d) => (
              <tr key={d.cle} style={{ borderBottom: `1px solid ${bordure}`, verticalAlign: "top" }}>
                <td style={{ padding: 6, whiteSpace: "nowrap" }}>{new Date(d.creeLe).toLocaleDateString("fr-FR")}</td>
                <td style={{ padding: 6 }}>
                  <Link href={`/admin/clients/${d.client.id}`}>{d.client.nom}</Link>
                </td>
                <td style={{ padding: 6 }}>
                  <span style={{ fontSize: 11, color: grisTexte }}>{SOURCES[d.source]}</span>
                  <br />
                  {d.libelle}
                  {d.detail && <div style={{ color: grisTexte, marginTop: 2 }}>« {d.detail} »</div>}
                </td>
                <td style={{ padding: 6 }}>
                  <Link href={d.objet.href}>{d.objet.titre}</Link>
                </td>
                <td style={{ padding: 6, color: STATUTS[d.statut].couleur, fontWeight: 600 }}>
                  {STATUTS[d.statut].texte}
                  {d.traiteParEmail && <div style={{ fontWeight: 400, color: grisTexte, fontSize: 11 }}>par {d.traiteParEmail}</div>}
                </td>
                <td style={{ padding: 6 }}>
                  {d.traitableIci && d.statut !== "CLOTUREE" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {d.statut === "ENVOYEE" && (
                        <button type="button" disabled={envoi === d.cle} onClick={() => traiter(d, "PRISE_EN_CHARGE")} style={BOUTON} aria-label={`Prendre en charge : ${d.libelle} — ${d.client.nom}`}>
                          Prendre en charge
                        </button>
                      )}
                      <button type="button" disabled={envoi === d.cle} onClick={() => traiter(d, "CLOTUREE")} style={BOUTON_SECONDAIRE} aria-label={`Clôturer : ${d.libelle} — ${d.client.nom}`}>
                        Clôturer
                      </button>
                    </div>
                  ) : d.statut !== "CLOTUREE" ? (
                    <Link href={d.objet.href}>Traiter sur la page dédiée</Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: 16, fontSize: 12, color: grisTexte }}>
        Pour répondre à une question du client, utilisez sa messagerie (page du client). Une décision « poursuivre » ne crée jamais de mission :
        la mission se crée depuis la page du besoin.
      </p>
    </div>
  );
}
