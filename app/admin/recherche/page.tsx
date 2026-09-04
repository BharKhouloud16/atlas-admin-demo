"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleuFonce, grisTexte, bordure } from "@/lib/theme";

type Resultats = {
  clients: { id: string; nom: string; email: string | null; secteur: string | null }[];
  profils: { id: string; nom: string; prenom: string | null; seniorite: string | null; disponibilite: string | null }[];
  missions: {
    id: string;
    repere: string | null;
    statut: string;
    client: { nom: string };
    profil: { nom: string; prenom: string | null };
  }[];
};

const VIDE: Resultats = { clients: [], profils: [], missions: [] };

// Recherche globale admin (voir app/api/recherche/route.ts) — un seul champ
// de recherche interrogeant clients, profils et missions à la fois, plutôt
// que de forcer l'Admin à chercher page par page.
export default function RecherchePage() {
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<Resultats>(VIDE);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    const terme = q.trim();
    if (terme.length < 2) {
      setResultats(VIDE);
      return;
    }
    setChargement(true);
    const identifiant = setTimeout(() => {
      fetch(`/api/recherche?q=${encodeURIComponent(terme)}`)
        .then((r) => r.json())
        .then((data) => setResultats({ ...VIDE, ...data }))
        .finally(() => setChargement(false));
    }, 300); // anti-rebond : évite un appel réseau à chaque frappe
    return () => clearTimeout(identifiant);
  }, [q]);

  const total = resultats.clients.length + resultats.profils.length + resultats.missions.length;

  return (
    <div>
      <h1>Recherche</h1>
      <input
        autoFocus
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nom d'un client, d'un ingénieur, repère de mission..."
        style={{ width: "100%", maxWidth: 480, padding: "10px 14px", borderRadius: 8, border: `1px solid ${bordure}`, fontSize: 14, marginTop: 8 }}
      />

      {q.trim().length >= 1 && q.trim().length < 2 && (
        <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Continuez à taper (2 caractères minimum).</p>
      )}
      {chargement && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Recherche...</p>}
      {!chargement && q.trim().length >= 2 && total === 0 && (
        <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun résultat pour « {q.trim()} ».</p>
      )}

      {resultats.clients.length > 0 && (
        <Section titre="Clients">
          {resultats.clients.map((c) => (
            <Ligne key={c.id} href="/admin/clients">
              <strong>{c.nom}</strong>
              {c.secteur && <span style={{ color: grisTexte }}> — {c.secteur}</span>}
              {c.email && <span style={{ color: "#888" }}> · {c.email}</span>}
            </Ligne>
          ))}
        </Section>
      )}

      {resultats.profils.length > 0 && (
        <Section titre="Ingénieurs">
          {resultats.profils.map((p) => (
            <Ligne key={p.id} href="/admin/profils">
              <strong>{p.prenom ? `${p.prenom} ${p.nom}` : p.nom}</strong>
              {p.seniorite && <span style={{ color: grisTexte }}> — {p.seniorite}</span>}
              {p.disponibilite && <span style={{ color: "#888" }}> · {p.disponibilite}</span>}
            </Ligne>
          ))}
        </Section>
      )}

      {resultats.missions.length > 0 && (
        <Section titre="Missions">
          {resultats.missions.map((m) => (
            <Ligne key={m.id} href="/admin/missions">
              <strong>{m.repere || "(sans repère)"}</strong>
              <span style={{ color: grisTexte }}>
                {" "}
                — {m.client.nom} / {m.profil.prenom ? `${m.profil.prenom} ${m.profil.nom}` : m.profil.nom}
              </span>
              <span style={{ color: "#888" }}> · {m.statut}</span>
            </Ligne>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: bleuFonce, marginBottom: 8 }}>{titre}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function Ligne({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{ display: "block", padding: "10px 12px", borderRadius: 8, border: `1px solid ${bordure}`, fontSize: 13, textDecoration: "none", color: "#000" }}
    >
      {children}
    </Link>
  );
}
