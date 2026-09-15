import { Section, BientotDisponible } from "@/components/client/primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : emplacement
// architectural réservé pour l'offre ATLAS OS / Services (QA, sécurité,
// cybersécurité, audit, analyse). Aucune fonctionnalité construite ici :
// il n'existe aujourd'hui aucun modèle de données pour un engagement de
// service ATLAS OS (Mission est structurellement pensée pour du Talent) —
// point à trancher avec le CEO avant tout lot futur sur cette rubrique.
export default function AtlasOSClientPage() {
  return (
    <Section title="ATLAS OS / Services">
      <BientotDisponible description="QA, sécurité, cybersécurité, audit et analyse : vos prestations ATLAS OS / Services apparaîtront ici, au même niveau que vos missions Talent — jamais l'une au-dessus de l'autre." />
    </Section>
  );
}
