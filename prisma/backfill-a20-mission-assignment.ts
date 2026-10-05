// A20 — Backfill contrôlé MissionAssignment (05/10/2026).
// Usage : npx tsx prisma/backfill-a20-mission-assignment.ts
// Idempotent — voir lib/mission/assignment-backfill.ts pour la stratégie
// complète (dates, statuts, anomalies) et sa justification.
import { executerBackfillAssignments } from "@/lib/mission/assignment-backfill";

async function main() {
  const resultat = await executerBackfillAssignments();
  console.log(JSON.stringify(resultat, null, 2));
  if (resultat.anomalies.length > 0) {
    console.error(`ATTENTION : ${resultat.anomalies.length} anomalie(s) rencontrée(s) — aucune donnée inventée, voir détail ci-dessus.`);
  }
}

main();
