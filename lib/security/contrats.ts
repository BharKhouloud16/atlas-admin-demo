// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Extrait de app/api/generate-contract/route.ts pour être testable
// unitairement sans dépendance réseau/DB — voir tests/unit/contrats.spec.ts.
// contrat_prestation et nda sont des documents destinés au CLIENT ;
// cdi/freelance/portage sont des contrats avec l'INGÉNIEUR lui-même, pour
// qui connaître sa propre rémunération (montant_profil) est légitime.
// tjm_cout (coût interne Atlas, marge) et montant_profil (rémunération de
// l'ingénieur) ne doivent JAMAIS être fournis au rendu d'un contrat
// client, quelle que soit la balise présente dans le .docx — voir
// templates/README.md.
export const TEMPLATES_INTERNES_INGENIEUR = new Set(["cdi", "freelance", "portage"]);

export function estTemplateInterneIngenieur(templateKey: string): boolean {
  return TEMPLATES_INTERNES_INGENIEUR.has(templateKey);
}
