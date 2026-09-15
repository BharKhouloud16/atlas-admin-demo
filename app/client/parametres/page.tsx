import { Section, BientotDisponible } from "@/components/client/primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : emplacement
// architectural réservé pour la gestion du compte/entreprise côté client —
// aujourd'hui inexistante (contrairement à l'espace Ingénieur, qui a déjà
// une page "Mon compte"). Aucune fonctionnalité de gestion de compte
// construite dans ce lot (hors périmètre du Workspace Foundation).
export default function ParametresClientPage() {
  return (
    <Section title="Entreprise & paramètres">
      <BientotDisponible description="Informations de votre entreprise, contacts autorisés et préférences de votre espace." />
    </Section>
  );
}
