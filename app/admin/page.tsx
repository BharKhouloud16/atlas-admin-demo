import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/lib/calculs";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";

// Un ingénieur qui a terminé son CV et son questionnaire de disponibilité a
// désormais son propre espace (/ingenieur) : ce tableau de bord ne lui est
// plus destiné. /admin/missions reste accessible depuis la navigation.
export default async function AdminHome() {
  const session = await getSession();
  if (session?.role === "INGENIEUR") {
    redirect("/ingenieur");
  }

  const debutMois = new Date();
  debutMois.setDate(1);
  debutMois.setHours(0, 0, 0, 0);

  const [
    missionsEnCours,
    missionsCeMois,
    nbClients,
    nbIngenieursActifs,
    nbComptesEnAttente,
    nbCvEnAttente,
    nbDemandesEnAttente,
    nbFeuillesEnAttente,
    hyp,
  ] = await Promise.all([
    prisma.mission.findMany({ where: { statut: "En cours" }, include: { client: true, profil: true } }),
    prisma.mission.count({ where: { createdAt: { gte: debutMois } } }),
    prisma.client.count(),
    prisma.user.count({ where: { role: "INGENIEUR", actif: true, desactive: false } }),
    prisma.user.count({ where: { actif: false } }),
    prisma.profil.count({ where: { cvUrl: { not: null }, cvValide: false } }),
    prisma.demandeContact.count({ where: { traite: false } }),
    prisma.feuilleDeTemps.count({ where: { statut: { in: ["Soumise", "ValideeAdmin"] } } }),
    prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} }),
  ]);

  // CA et marge prévisionnels : missions en cours, valorisées sur leur durée
  // totale prévue (nbJours) — même formule exacte que /admin/missions
  // (voir lib/calculs.ts : calculerTjmCout), pour rester cohérent partout.
  let caPrevisionnel = 0;
  let margeTotale = 0;
  let margeCalculable = 0;
  for (const m of missionsEnCours) {
    const ca = m.tjmVente * m.nbJours;
    caPrevisionnel += ca;
    const tjmCout = calculerTjmCout(m.profil.type, m.profil.montantSaisi, hyp);
    if (tjmCout != null) {
      const tjmCoutOverhead = tjmCout * (1 + hyp.overhead);
      const coutTotal = tjmCoutOverhead * m.nbJours;
      margeTotale += ca - coutTotal;
      margeCalculable += ca;
    }
  }
  const margePctMoyenne = margeCalculable > 0 ? Math.round((margeTotale / margeCalculable) * 100) : null;

  const kpis = [
    { label: "Missions en cours", valeur: String(missionsEnCours.length), lien: "/admin/missions" },
    { label: "Clients", valeur: String(nbClients), lien: "/admin/clients" },
    { label: "Ingénieurs actifs", valeur: String(nbIngenieursActifs), lien: "/admin/ingenieurs" },
    {
      label: "Comptes en attente",
      valeur: String(nbComptesEnAttente),
      lien: "/admin/comptes-en-attente",
      alerte: nbComptesEnAttente > 0,
    },
    {
      label: "CV en attente de validation",
      valeur: String(nbCvEnAttente),
      lien: "/admin/profils",
      alerte: nbCvEnAttente > 0,
    },
    {
      label: "Feuilles de temps à traiter",
      valeur: String(nbFeuillesEnAttente),
      lien: "/admin/feuilles-de-temps",
      alerte: nbFeuillesEnAttente > 0,
    },
    {
      label: "Demandes de contact en attente",
      valeur: String(nbDemandesEnAttente),
      lien: "/admin/demandes",
      alerte: nbDemandesEnAttente > 0,
    },
    { label: "Nouvelles missions ce mois-ci", valeur: String(missionsCeMois), lien: "/admin/missions" },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Tableau de bord</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 24, maxWidth: 700 }}>
        Vue d'ensemble en temps réel de l'activité Atlas Quality Partners.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.lien}
            style={{
              textDecoration: "none",
              border: `1px solid ${k.alerte ? "#f3c56b" : bordure}`,
              background: k.alerte ? "#fffaf0" : "#fff",
              borderRadius: 8,
              padding: 14,
              display: "block",
            }}
          >
            <p style={{ fontSize: 12, color: grisTexte, margin: "0 0 6px" }}>{k.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: k.alerte ? "#b45309" : bleuFonce }}>
              {k.valeur}
            </p>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 12, color: grisTexte, margin: "0 0 6px" }}>
            CA prévisionnel — missions en cours (durée totale prévue)
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: bleuFonce }}>
            {Math.round(caPrevisionnel).toLocaleString("fr-FR")} €
          </p>
        </div>
        <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 12, color: grisTexte, margin: "0 0 6px" }}>Marge moyenne estimée</p>
          <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: bleuFonce }}>
            {margePctMoyenne != null ? `${margePctMoyenne} %` : "—"}
          </p>
        </div>
      </div>

      <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px", color: bleuFonce }}>
          Missions en cours
        </p>
        {missionsEnCours.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Aucune mission en cours actuellement.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
                  <th style={{ padding: "6px 8px" }}>Client</th>
                  <th style={{ padding: "6px 8px" }}>Ingénieur</th>
                  <th style={{ padding: "6px 8px" }}>Repère</th>
                  <th style={{ padding: "6px 8px" }}>Jours</th>
                  <th style={{ padding: "6px 8px" }}>TJM vente</th>
                </tr>
              </thead>
              <tbody>
                {missionsEnCours.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 8px" }}>{m.client.nom}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {m.profil.prenom ? `${m.profil.prenom} ${m.profil.nom}` : m.profil.nom}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{m.repere ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{m.nbJours}</td>
                    <td style={{ padding: "6px 8px" }}>{Math.round(m.tjmVente)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ fontSize: 12, color: "#aab0ba", marginTop: 20 }}>
        Pour le détail des marges, coûts internes et la génération des contrats, voir{" "}
        <Link href="/admin/missions" style={{ color: bleu }}>
          Missions
        </Link>
        .
      </p>
    </div>
  );
}
