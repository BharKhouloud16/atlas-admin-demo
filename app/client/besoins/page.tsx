import { Section, BientotDisponible } from "@/components/client/primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : emplacement
// architectural réservé pour le futur Client Need Intelligence (Lot 2+) —
// EXPRESSÉMENT interdit de construire dans ce lot (aucun moteur, aucun
// modèle NeedIntake, aucune IA). Cette rubrique deviendra le point d'entrée
// unique d'un besoin, qu'il se résolve en Talent, en ATLAS OS/Services, ou
// les deux — jamais l'un au-dessus de l'autre.
export default function BesoinsClientPage() {
  return (
    <Section title="Besoins">
      <BientotDisponible description="Un point d'entrée unique pour exprimer un besoin — qu'il concerne un talent, une prestation ATLAS OS/Services, ou les deux — avec une aide à la clarification quand vous ne savez pas encore précisément ce dont vous avez besoin. En attendant, la rubrique « Talents » reste disponible pour exprimer un besoin de talent." />
    </Section>
  );
}
