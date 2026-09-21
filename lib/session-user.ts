import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 1, 21/09/2026).
//
// SessionUser (lib/auth.ts) ne porte pas User.id (email/role/profilId/
// clientId/desactive uniquement) — jamais modifié ici, le JWT reste hors
// périmètre (risque minimal). Résout le User.id réel par email, seul champ
// stable disponible en session, même patron que
// app/api/auth/2fa/desactiver/route.ts. Un seul aller-retour, jamais une
// boucle.
export async function resoudreUserId(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}
