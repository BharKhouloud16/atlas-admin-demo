import { Section, BientotDisponible } from "@/components/client/primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : emplacement
// architectural réservé pour la communication intégrée (Lot 6). Aucun
// modèle de messagerie n'existe aujourd'hui dans le repository (audit
// confirmé : seul un canal email transactionnel à sens unique existe,
// lib/email.ts) — expressément interdit de construire ici.
export default function CommunicationClientPage() {
  return (
    <Section title="Communication">
      <BientotDisponible description="Un fil de discussion avec votre équipe ATLAS, directement dans votre espace — pour ne plus dépendre uniquement des e-mails." />
    </Section>
  );
}
