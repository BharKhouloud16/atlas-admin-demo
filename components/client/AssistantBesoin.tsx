"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { bleu, bleuFonce, bordure, grisTexte } from "@/lib/theme";
import { Card, Bouton } from "@/components/client/primitives";
import { COMPETENCES_GROUPES } from "@/lib/competences";
import { PAYS } from "@/lib/localisation";
import { contientCompetence, extraireBudget, normaliserTexte } from "@/lib/ai/heuristiques";
import { DUREES, MODES_TRAVAIL, SENIORITES, TYPES_MISSION } from "@/lib/client-need/criteres-declares";

// LOT 7 (01/11/2026) — « Exprimer un besoin » en 4 étapes (planche) :
// Informations générales → Compétences → Critères → Validation, avec un
// panneau d'aide. Le texte libre reste au cœur du parcours : ATLAS l'analyse
// comme avant ; les choix faits ici sont des critères DÉCLARÉS (validés côté
// serveur) qui l'emportent sur ce que l'analyse aurait déduit. Les
// compétences citées dans la description sont pré-cochées (même règle de
// reconnaissance que l'analyse serveur), le Client garde la main.

const ETAPES = ["Informations générales", "Compétences", "Critères", "Validation"] as const;
const DESCRIPTION_MAX = 2000;

type Saisie = {
  titre: string;
  description: string;
  typeMission: string;
  duree: string;
  localisation: string;
  competences: string[];
  seniorite: string;
  quantite: string;
  budgetTjm: string;
  dateDebut: string;
  modeTravail: string;
};

const VIDE: Saisie = {
  titre: "",
  description: "",
  typeMission: "",
  duree: "",
  localisation: "",
  competences: [],
  seniorite: "",
  quantite: "",
  budgetTjm: "",
  dateDebut: "",
  modeTravail: "",
};

const styleChamp = { width: "100%", padding: 8, borderRadius: 6, border: `1px solid ${bordure}`, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" } as const;

export function AssistantBesoin({ onCree }: { onCree: () => void }) {
  const [etape, setEtape] = useState(0);
  const [s, setS] = useState<Saisie>(VIDE);
  const [competencesTouchees, setCompetencesTouchees] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const maj = (k: keyof Saisie) => (e: { target: { value: string } }) => setS((x) => ({ ...x, [k]: e.target.value }));
  const etapeValide = etape !== 0 || (s.titre.trim().length > 0 && s.description.trim().length >= 10 && s.typeMission !== "");

  // Compétences reconnues dans la description (pré-cochées une seule fois).
  const detectees = useMemo(() => {
    const texte = normaliserTexte(`${s.titre} ${s.description}`);
    return COMPETENCES_GROUPES.flatMap((g) => g.competences).filter((c) => contientCompetence(texte, c));
  }, [s.titre, s.description]);

  function allerA(suivante: number) {
    if (etape === 0 && suivante === 1 && !competencesTouchees) {
      const budget = extraireBudget(normaliserTexte(s.description));
      setS((x) => ({ ...x, competences: detectees, budgetTjm: x.budgetTjm || (budget?.journalier ? String(budget.montant) : "") }));
    }
    setEtape(suivante);
  }

  function basculerCompetence(c: string) {
    setCompetencesTouchees(true);
    setS((x) => ({ ...x, competences: x.competences.includes(c) ? x.competences.filter((y) => y !== c) : [...x.competences, c] }));
  }

  async function envoyer() {
    setErreur(null);
    setEnvoi(true);
    const criteres = {
      typeMission: s.typeMission || undefined,
      duree: s.duree || undefined,
      localisation: s.localisation || undefined,
      competences: s.competences,
      seniorite: s.seniorite || undefined,
      quantite: s.quantite ? Number(s.quantite) : undefined,
      budgetTjm: s.budgetTjm ? Number(s.budgetTjm) : undefined,
      dateDebut: s.dateDebut || undefined,
      modeTravail: s.modeTravail || undefined,
    };
    const r = await fetch("/api/client/besoins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre: s.titre, texteOriginal: s.description, criteres }),
    }).catch(() => null);
    setEnvoi(false);
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {};
      setErreur(d.error ?? "Une erreur est survenue. Votre saisie est conservée : réessayez.");
      return;
    }
    setS(VIDE);
    setEtape(0);
    setCompetencesTouchees(false);
    onCree();
  }

  const champ = (id: keyof Saisie, libelle: string, enfant: React.ReactNode, aide?: string) => (
    <div style={{ fontSize: 13, flex: "1 1 180px" }}>
      <label htmlFor={`besoin-${id}`} style={{ display: "block", marginBottom: 4, color: grisTexte }}>
        {libelle}
      </label>
      {enfant}
      {aide && <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "#7a8599" }}>{aide}</span>}
    </div>
  );
  const select = (id: keyof Saisie, options: readonly string[]) => (
    <select id={`besoin-${id}`} value={s[id] as string} onChange={maj(id)} style={styleChamp}>
      <option value="">Choisir</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  const recap: [string, string][] = [
    ["Intitulé", s.titre],
    ["Description", s.description],
    ["Type de mission", s.typeMission],
    ["Durée estimée", s.duree],
    ["Localisation", s.localisation],
    ["Compétences", s.competences.join(", ")],
    ["Séniorité", s.seniorite],
    ["Nombre de profils", s.quantite],
    ["Budget journalier (€ HT)", s.budgetTjm],
    ["Début souhaité", s.dateDebut],
    ["Mode de travail", s.modeTravail],
  ];

  const filtre = normaliserTexte(recherche.trim());

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <Card style={{ flex: "3 1 440px", minWidth: 0 }}>
        <ol aria-label="Étapes" style={{ display: "flex", gap: 16, listStyle: "none", padding: 0, margin: "0 0 16px", flexWrap: "wrap" }}>
          {ETAPES.map((e, i) => (
            <li key={e} aria-current={i === etape ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: i === etape ? 700 : 400, color: i <= etape ? bleuFonce : grisTexte }}>
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: i === etape ? bleuFonce : "#fff",
                  color: i === etape ? "#fff" : grisTexte,
                  border: `1px solid ${i === etape ? bleuFonce : bordure}`,
                }}
              >
                {i + 1}
              </span>
              {e}
            </li>
          ))}
        </ol>

        <div style={{ display: "grid", gap: 12 }}>
          {etape === 0 && (
            <>
              {champ("titre", "Intitulé du besoin *", <input id="besoin-titre" value={s.titre} onChange={maj("titre")} maxLength={200} placeholder="Ex. : Ingénieur QA automation" style={styleChamp} />)}
              {champ(
                "description",
                "Description du besoin *",
                <textarea
                  id="besoin-description"
                  value={s.description}
                  onChange={maj("description")}
                  maxLength={DESCRIPTION_MAX}
                  rows={5}
                  placeholder="Décrivez le contexte, les missions, les objectifs. Ex. : nous cherchons deux QA automation seniors pour renforcer notre équipe pendant six mois, sur Playwright et Java."
                  style={styleChamp}
                />,
                `${s.description.length}/${DESCRIPTION_MAX} — ATLAS analyse ce texte et vous montre ce qu'il a compris.`
              )}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {champ("typeMission", "Type de mission *", select("typeMission", TYPES_MISSION))}
                {champ("duree", "Durée estimée", select("duree", DUREES))}
                {champ("localisation", "Localisation", select("localisation", PAYS as readonly string[]))}
              </div>
            </>
          )}

          {etape === 1 && (
            <>
              <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>
                Compétences clés. {detectees.length > 0 ? "Celles citées dans votre description sont déjà cochées." : "Cochez celles qui comptent pour ce besoin."}
              </p>
              {champ(
                "competences",
                "Rechercher une compétence",
                <input id="besoin-competences" type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Ex. : Playwright" style={styleChamp} />
              )}
              {COMPETENCES_GROUPES.map((g) => {
                const visibles = g.competences.filter((c) => !filtre || normaliserTexte(c).includes(filtre));
                if (visibles.length === 0) return null;
                return (
                  <fieldset key={g.categorie} style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend style={{ fontSize: 12, fontWeight: 700, color: bleuFonce, marginBottom: 6 }}>{g.categorie}</legend>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                      {visibles.map((c) => (
                        <label key={c} style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <input type="checkbox" checked={s.competences.includes(c)} onChange={() => basculerCompetence(c)} />
                          {c}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
              <p role="status" style={{ margin: 0, fontSize: 12, color: grisTexte }}>
                {s.competences.length} compétence{s.competences.length > 1 ? "s" : ""} sélectionnée{s.competences.length > 1 ? "s" : ""}
              </p>
            </>
          )}

          {etape === 2 && (
            <>
              <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>Tous ces critères sont facultatifs : précisez ceux que vous connaissez.</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {champ("seniorite", "Séniorité", select("seniorite", SENIORITES))}
                {champ("quantite", "Nombre de profils", <input id="besoin-quantite" type="number" min={1} max={50} value={s.quantite} onChange={maj("quantite")} style={styleChamp} />)}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {champ("budgetTjm", "Budget journalier maximum (€ HT)", <input id="besoin-budgetTjm" type="number" min={1} value={s.budgetTjm} onChange={maj("budgetTjm")} style={styleChamp} />, "Un ordre de grandeur suffit.")}
                {champ("dateDebut", "Début souhaité", <input id="besoin-dateDebut" type="month" value={s.dateDebut} onChange={maj("dateDebut")} style={styleChamp} />)}
                {champ("modeTravail", "Mode de travail", select("modeTravail", MODES_TRAVAIL))}
              </div>
            </>
          )}

          {etape === 3 && (
            <dl style={{ margin: 0, fontSize: 13, display: "grid", gridTemplateColumns: "minmax(120px, 190px) 1fr", gap: "6px 12px" }}>
              {recap.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt style={{ color: grisTexte }}>{k}</dt>
                  <dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{v || <em style={{ color: "#9aa3b2" }}>non renseigné</em>}</dd>
                </div>
              ))}
            </dl>
          )}

          {erreur && (
            <p role="alert" style={{ margin: 0, color: "#c0392b", fontSize: 13 }}>
              {erreur}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {etape > 0 && (
              <Bouton variant="secondary" onClick={() => setEtape(etape - 1)} disabled={envoi}>
                Précédent
              </Bouton>
            )}
            {etape < 3 ? (
              <Bouton onClick={() => allerA(etape + 1)} disabled={!etapeValide}>
                Suivant
              </Bouton>
            ) : (
              <Bouton onClick={envoyer} disabled={envoi}>
                {envoi ? "Analyse en cours…" : "Envoyer le besoin"}
              </Bouton>
            )}
          </div>
        </div>
      </Card>

      <aside aria-label="Aide" style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 12 }}>
        <Card>
          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14, color: bleuFonce }}>Besoin d&apos;aide ?</p>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: grisTexte }}>Notre équipe vous accompagne pour définir votre besoin et trouver les bons profils.</p>
          <Link href="/client/communication" style={{ fontSize: 13, color: bleu, fontWeight: 600 }}>
            Écrire à l&apos;équipe ATLAS
          </Link>
        </Card>
        <Card>
          <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 14, color: bleuFonce }}>Ce qui se passe ensuite</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: grisTexte, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>ATLAS analyse votre besoin et vous montre ce qu&apos;il a compris.</li>
            <li>Vous corrigez ou complétez, puis vous validez.</li>
            <li>Jusqu&apos;à cinq profils admissibles vous sont proposés, de façon anonyme, dans Talents.</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
