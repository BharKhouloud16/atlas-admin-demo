// COMPANY ATLAS — V2.2-B : Billing Foundation — numérotation de facture.
//
// Même format que la route pré-existante app/api/feuilles-de-temps/facture
// (FA-{mois}-{missionId6}), volontairement conservé pour rester lisible et
// cohérent avec l'historique déjà généré avant ce lot — jamais un second
// vocabulaire de numérotation. L'unicité réelle est garantie par la
// contrainte @unique sur Facture.numeroFacture (voir prisma/schema.prisma)
// : cette fonction n'a pas besoin d'être elle-même infaillible, la base la
// rejette explicitement en cas de collision plutôt que de l'accepter
// silencieusement.
export function genererNumeroFacture(mois: string, missionId: string): string {
  return `FA-${mois.replace("-", "")}-${missionId.slice(0, 6).toUpperCase()}`;
}
