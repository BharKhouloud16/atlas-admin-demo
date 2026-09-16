"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bordure, grisTexte, vert } from "@/lib/theme";

type BesoinAdmin = {
  id: string;
  titre: string | null;
  texteOriginal: string;
  statut: string;
  coherenceStatut: string;
  createdAt: string;
  client: { nom: string };
  demandeTalentCreee: { id: string } | null;
};

const LABEL_STATUT: Record<string, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis",
  A_CLARIFIER: "À clarifier",
  VALIDE: "Validé",
  ARCHIVE: "Archivé",
};

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
//
// Vue Admin transverse de tous les ClientNeed (LOT 2/3) — le pont manquant
// identifié par l'audit stratégique : jusqu'ici, aucun écran Admin
// n'affichait ces besoins, qui n'avaient donc aucun consommateur réel.
// Les besoins VALIDÉS et non encore liés à une DemandeTalent sont mis en
// avant en premier (action attendue), sans jamais masquer les autres.
export default function BesoinsTalentAdminPage() {
  const [besoins, setBesoins] = useState<BesoinAdmin[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    fetch("/api/talent/besoins")
      .then((r) => r.json())
      .then((d) => {
        setBesoins(Array.isArray(d.besoins) ? d.besoins : []);
        setChargement(false);
      });
  }, []);

  const aTraiter = besoins.filter((b) => b.statut === "VALIDE" && !b.demandeTalentCreee);
  const autres = besoins.filter((b) => !(b.statut === "VALIDE" && !b.demandeTalentCreee));

  return (
    <div>
      <h1>Besoins clients — Atlas Talent</h1>
      <p style={{ color: grisTexte, fontSize: 13, maxWidth: 640 }}>
        Chaque besoin soumis par un client (rubrique &quot;Besoins&quot; de son espace) apparaît ici une fois validé. Créer une demande Talent reste
        toujours une décision explicite — rien n&apos;est jamais généré automatiquement.
      </p>
      {chargement && <p style={{ color: "#888" }}>Chargement…</p>}
      {!chargement && besoins.length === 0 && <p style={{ color: "#888" }}>Aucun besoin pour l&apos;instant.</p>}

      {aTraiter.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15 }}>À examiner ({aTraiter.length})</h2>
          <ListeBesoins besoins={aTraiter} />
        </section>
      )}

      {autres.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, color: grisTexte }}>Autres besoins</h2>
          <ListeBesoins besoins={autres} />
        </section>
      )}
    </div>
  );
}

function ListeBesoins({ besoins }: { besoins: BesoinAdmin[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {besoins.map((b) => (
        <li key={b.id}>
          <Link
            href={`/admin/talent/besoins/${b.id}`}
            style={{ display: "block", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {b.titre ?? b.texteOriginal.slice(0, 60)} <span style={{ color: grisTexte, fontWeight: 400 }}>— {b.client.nom}</span>
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>{b.texteOriginal.slice(0, 100)}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${bleu}`, color: bleu, whiteSpace: "nowrap" }}>
                  {LABEL_STATUT[b.statut] ?? b.statut}
                </span>
                {b.demandeTalentCreee && (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${vert}`, color: vert, whiteSpace: "nowrap" }}>
                    Demande créée
                  </span>
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
