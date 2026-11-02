import { Section, BientotDisponible } from "@/components/client/primitives";

// LOT 7 (01/11/2026, planche) — « Actualités & veille » : rubrique annoncée,
// SANS contenu tant qu'aucune source réglementaire vérifiée et datée n'est
// branchée. Aucune actualité inventée.
export default function VeillePage() {
  return (
    <Section title="Actualités & veille">
      <BientotDisponible description="Une veille réglementaire sourcée et datée, utile à vos besoins et à vos missions. Aucune actualité n'est affichée tant que ce service n'est pas opérationnel." />
    </Section>
  );
}
