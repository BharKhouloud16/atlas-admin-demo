import { prisma } from "@/lib/prisma";
import { CHAMPS_ENTREPRISE, manquantsPour, type EtapeCompletude, type ClientPourCompletude } from "./completude";

// LOT 3 (28/10/2026) — contrôle SERVEUR de complétude avant une opération
// protégée (jamais seulement un bouton grisé côté interface).
export async function verifierCompletudeClient(clientId: string, etape: EtapeCompletude): Promise<{ ok: true } | { ok: false; manquants: string[] }> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: Object.fromEntries(CHAMPS_ENTREPRISE.map((c) => [c, true])) as Record<string, true>,
  });
  if (!client) return { ok: false, manquants: ["Profil entreprise introuvable"] };
  const manquants = manquantsPour(client as unknown as ClientPourCompletude, etape);
  return manquants.length === 0 ? { ok: true } : { ok: false, manquants };
}

export function messageCompletude(manquants: string[]): string {
  return `Complétez d'abord votre profil entreprise (rubrique Profil) : ${manquants.join(", ")}.`;
}
