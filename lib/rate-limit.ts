import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Limitation de débit sans dépendance externe (pas de Redis/Upstash
// configuré pour cette démo) : une fenêtre glissante simple stockée en
// base (voir TentativeIp dans prisma/schema.prisma), complétée par un
// verrouillage progressif par compte (voir User.echecsConnexion ci-dessous)
// pour ralentir un bruteforce ciblé même quand l'IP change.

const FENETRE_MS = 15 * 60 * 1000; // 15 minutes
// Configurable via RATE_LIMIT_LOGIN_MAX_IP (défaut 20) — ajouté le 06/09 :
// dans la CI, toutes les requêtes du serveur `next start` local partagent la
// même IP ("inconnue", voir adresseIp ci-dessous, aucun en-tête
// x-forwarded-for/x-real-ip en local), donc la même clé de compteur pour
// TOUTE la suite de tests (API + E2E) — largement plus de 20 connexions au
// total. .github/workflows/ci.yml relève ce seuil pour l'environnement de
// test uniquement ; en production (Vercel, IP réelle par visiteur), le
// défaut de 20 reste inchangé.
const MAX_TENTATIVES_PAR_IP = Number(process.env.RATE_LIMIT_LOGIN_MAX_IP) || 20; // par fenêtre de 15 min, tous emails confondus

export function adresseIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "inconnue";
}

// Retourne true si la requête est autorisée à continuer, false si l'IP a
// dépassé le seuil de tentatives sur la fenêtre en cours. Incrémente le
// compteur à chaque appel (donc à appeler une seule fois par tentative).
export async function verifierLimiteIp(cle: string): Promise<boolean> {
  const maintenant = new Date();
  const existante = await prisma.tentativeIp.findUnique({ where: { cle } });

  if (!existante || maintenant.getTime() - existante.fenetreDebut.getTime() > FENETRE_MS) {
    await prisma.tentativeIp.upsert({
      where: { cle },
      create: { cle, compteur: 1, fenetreDebut: maintenant },
      update: { compteur: 1, fenetreDebut: maintenant },
    });
    return true;
  }

  if (existante.compteur >= MAX_TENTATIVES_PAR_IP) {
    return false;
  }

  await prisma.tentativeIp.update({ where: { cle }, data: { compteur: { increment: 1 } } });
  return true;
}

// Verrouillage progressif par compte : à partir de 5 échecs, la durée de
// verrouillage double à chaque échec supplémentaire (5 => 1 min, 6 => 2 min,
// ... plafonné à 60 min) plutôt qu'un seuil fixe, pour dissuader un
// bruteforce patient sans jamais bloquer définitivement le titulaire légitime.
const SEUIL_VERROUILLAGE = 5;
const PLAFOND_VERROUILLAGE_MIN = 60;

export function calculerVerrouillage(echecs: number): Date | null {
  if (echecs < SEUIL_VERROUILLAGE) return null;
  const minutes = Math.min(2 ** (echecs - SEUIL_VERROUILLAGE), PLAFOND_VERROUILLAGE_MIN);
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function enregistrerEchecConnexion(userId: string, echecsActuels: number) {
  const echecs = echecsActuels + 1;
  const verrou = calculerVerrouillage(echecs);
  await prisma.user.update({
    where: { id: userId },
    data: { echecsConnexion: echecs, verrouilleJusqua: verrou },
  });
}

export async function reinitialiserEchecsConnexion(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { echecsConnexion: 0, verrouilleJusqua: null },
  });
}
