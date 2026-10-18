import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { traiterRappelsDus } from "@/lib/interview/reminders";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §12, §15. Point d'entrée interne UNIQUE pour le traitement des
// InterviewReminder dus — appelé exclusivement par un cron EXTERNE à
// ATLAS (infrastructure d'hébergement), jamais par un navigateur, jamais
// par une session applicative. Volontairement absent de
// middleware.ts::config.matcher : aucune session n'est attendue ici, la
// protection est entièrement portée par ce fichier (en-tête à secret
// partagé), même esprit que le pattern SEED_TOKEN déjà cité par le
// contrat pour les scripts d'amorçage — note d'implémentation : aucune
// variable nommée littéralement SEED_TOKEN n'existe réellement dans ce
// dépôt à ce jour (vérifié par recherche complète avant d'écrire ce
// fichier) ; le mécanisme ci-dessous reprend néanmoins exactement l'esprit
// décrit (secret partagé en en-tête HTTP, comparaison à temps constant via
// crypto.timingSafeEqual déjà en usage dans lib/url-signee.ts) plutôt que
// d'inventer un nouveau type de mécanisme d'authentification.
//
// ⚠️ PRODUCTION : ce point d'entrée ne déclenche RIEN par lui-même — il
// doit être appelé périodiquement par un mécanisme de cron réellement
// configuré au niveau de l'hébergement (ex. Vercel Cron, ou tout
// ordonnanceur externe). Sans cette configuration, AUCUN rappel n'est
// jamais envoyé automatiquement en production, quel que soit le contenu
// de ce fichier — voir le rapport final du lot pour la configuration
// manquante à ajouter.

const EN_TETE_SECRET = "x-internal-secret";

// Comparaison à temps constant qui ne révèle jamais la longueur réelle du
// secret attendu : les deux valeurs sont d'abord condensées en HMAC-SHA256
// (sortie fixe 32 octets), éliminant toute branche sur la longueur de la
// valeur fournie par l'appelant avant l'appel à crypto.timingSafeEqual
// (qui lève sinon une exception sur des buffers de longueurs différentes).
function secretsEgaux(valeurFournie: string, valeurAttendue: string): boolean {
  const condenser = (v: string) => crypto.createHash("sha256").update(v, "utf-8").digest();
  return crypto.timingSafeEqual(condenser(valeurFournie), condenser(valeurAttendue));
}

export async function POST(req: NextRequest) {
  // Default-deny : configuration absente/vide => endpoint désactivé, quel
  // que soit l'en-tête fourni. Jamais un repli permissif.
  const secretAttendu = process.env.INTERVIEW_REMINDER_INTERNAL_SECRET;
  if (!secretAttendu || secretAttendu.trim() === "") {
    console.error(
      "[interview-reminders:configuration] INTERVIEW_REMINDER_INTERNAL_SECRET manquant ou vide — endpoint de traitement des rappels désactivé (fail-closed)."
    );
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const secretFourni = req.headers.get(EN_TETE_SECRET);
  // Jamais le secret (fourni ou attendu) dans un log, dans la réponse, ou
  // dans un message d'erreur — uniquement le fait du refus.
  if (!secretFourni || !secretsEgaux(secretFourni, secretAttendu)) {
    console.error("[interview-reminders:securite] Tentative d'accès à l'endpoint interne avec un secret absent ou invalide.");
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const resultat = await traiterRappelsDus();
  return NextResponse.json(resultat);
}
