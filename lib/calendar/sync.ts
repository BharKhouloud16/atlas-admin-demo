import { prisma } from "@/lib/prisma";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.7, §11. EXTERNAL INTEGRATION — découplée du domaine ATLAS : ce module
// n'est JAMAIS appelé par lib/interview/service.ts, et ne lit/n'écrit
// jamais Interview.statut ni InterviewParticipant.statutInvitation.
// Invariant absolu, vérifié par construction : aucune lecture de
// statutSync n'influence jamais le lifecycle Interview.
//
// Aucun provider réel n'est implémenté dans ce lot (confirmé §11/§13/§21 —
// aucune intégration calendrier réelle n'est dans le périmètre). Le
// mécanisme ci-dessous est prêt pour qu'un futur lot y branche un vrai
// provider sans redesign : `resoudreProvider()` retourne systématiquement
// `null` tant qu'aucun provider n'est réellement configuré, et chaque
// fonction documente explicitement qu'elle reste à l'état EN_ATTENTE dans
// ce cas — jamais un succès simulé.

export class CalendarSyncRecordIntrouvableError extends Error {
  constructor() {
    super("CALENDAR_SYNC_RECORD_INTROUVABLE");
  }
}

export type EvenementCalendrierContexte = {
  dateHeure: Date;
  dureeMinutes: number;
  canal: string;
  lieu?: string | null;
  meetingUrl?: string | null;
};

// Abstraction du provider — aucune implémentation réelle dans ce lot
// (§11 : "aucun appel réel à un fournisseur n'est implémenté"). Un futur
// lot d'intégration (Google Calendar, Outlook...) fournit une implémentation
// réelle de ce type et la branche dans resoudreProvider() ci-dessous.
export type CalendarProvider = {
  nom: string;
  creerEvenement(contexte: EvenementCalendrierContexte): Promise<{ externalEventId: string }>;
  mettreAJourEvenement(externalEventId: string, contexte: EvenementCalendrierContexte): Promise<void>;
  annulerEvenement(externalEventId: string): Promise<void>;
};

// Aucune variable d'environnement de provider calendrier réel n'existe
// dans ce dépôt à ce jour — confirmé par l'audit préalable à ce lot.
// Retourne toujours `null` : documente explicitement l'absence de
// configuration réelle plutôt que de la supposer, conformément à la
// contrainte du mandat ("ne prétends pas qu'un mécanisme est automatique
// sans configuration réellement en place").
function resoudreProvider(): CalendarProvider | null {
  return null;
}

// Trigger unique (§11) : statutInvitation -> ACCEPTEE sur UN
// InterviewParticipant. Crée le CalendarSyncRecord s'il n'existe pas
// encore (idempotent via @@unique([interviewParticipantId])), puis tente
// une synchronisation. Sans provider réel configuré, la ligne reste
// EN_ATTENTE — jamais un SUCCES simulé.
export async function declencherSyncApresAcceptation(interviewParticipantId: string, contexte: EvenementCalendrierContexte) {
  const provider = resoudreProvider();

  const existant = await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId } });
  if (!existant) {
    await prisma.calendarSyncRecord.create({
      data: { interviewParticipantId, statutSync: "EN_ATTENTE", provider: provider?.nom ?? null },
    });
  }

  if (!provider) return;

  await tenterSync(interviewParticipantId, provider, contexte);
}

async function tenterSync(interviewParticipantId: string, provider: CalendarProvider, contexte: EvenementCalendrierContexte) {
  const record = await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId } });
  if (!record) throw new CalendarSyncRecordIntrouvableError();

  try {
    if (record.externalEventId) {
      await provider.mettreAJourEvenement(record.externalEventId, contexte);
      await prisma.calendarSyncRecord.update({
        where: { interviewParticipantId },
        data: { statutSync: "SUCCES", dernierEssaiLe: new Date(), erreurDetail: null, provider: provider.nom },
      });
      return;
    }

    const { externalEventId } = await provider.creerEvenement(contexte);
    await prisma.calendarSyncRecord.update({
      where: { interviewParticipantId },
      data: { statutSync: "SUCCES", externalEventId, dernierEssaiLe: new Date(), erreurDetail: null, provider: provider.nom },
    });
  } catch (erreur) {
    // Failure isolée par participant — n'altère jamais Interview.statut
    // ni les autres CalendarSyncRecord (§11).
    await prisma.calendarSyncRecord.update({
      where: { interviewParticipantId },
      data: {
        statutSync: "ECHEC",
        dernierEssaiLe: new Date(),
        erreurDetail: erreur instanceof Error ? erreur.message.slice(0, 1000) : "ECHEC_SYNC_INCONNU",
      },
    });
  }
}

// Reschedule (§11) : réutilise l'externalEventId existant, jamais une
// recréation — même ligne CalendarSyncRecord mise à jour.
export async function resynchroniserApresReprogrammation(interviewParticipantId: string, contexte: EvenementCalendrierContexte) {
  const provider = resoudreProvider();
  if (!provider) return;

  const record = await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId } });
  if (!record || record.statutSync === "NON_CONNECTE") return;

  await tenterSync(interviewParticipantId, provider, contexte);
}

// Cancellation (§11) : annulation externe via externalEventId, puis
// statutSync: ANNULE_EXTERNE — jamais de suppression physique de la ligne.
export async function annulerSync(interviewParticipantId: string) {
  const provider = resoudreProvider();
  const record = await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId } });
  if (!record) return;

  if (provider && record.externalEventId) {
    try {
      await provider.annulerEvenement(record.externalEventId);
    } catch (erreur) {
      await prisma.calendarSyncRecord.update({
        where: { interviewParticipantId },
        data: {
          statutSync: "ECHEC",
          dernierEssaiLe: new Date(),
          erreurDetail: erreur instanceof Error ? erreur.message.slice(0, 1000) : "ECHEC_ANNULATION_INCONNU",
        },
      });
      return;
    }
  }

  await prisma.calendarSyncRecord.update({ where: { interviewParticipantId }, data: { statutSync: "ANNULE_EXTERNE" } });
}

export async function lireCalendarSyncRecord(interviewParticipantId: string) {
  return prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId } });
}

// Job de resynchronisation (§11) : retente les lignes ECHEC, borné par
// `limite` par invocation (le compteur de tentatives persistant n'existe
// pas dans ce schéma — le bornage se fait au niveau du lot traité par
// appel, pas d'un compteur par ligne). Sans provider réel configuré, ce
// job ne fait rien — documenté explicitement, jamais un no-op silencieux
// faussement réussi.
export async function resynchroniserEchecs(limite = 50) {
  const provider = resoudreProvider();
  if (!provider) {
    console.error("[calendar:configuration] Aucun provider calendrier réel configuré — resynchronisation ECHEC sans effet.");
    return { traitees: 0 };
  }

  const lignesEchec = await prisma.calendarSyncRecord.findMany({
    where: { statutSync: "ECHEC" },
    take: limite,
    select: { interviewParticipantId: true, interviewParticipant: { select: { interview: true } } },
  });

  for (const ligne of lignesEchec) {
    const interview = ligne.interviewParticipant.interview;
    await tenterSync(ligne.interviewParticipantId, provider, {
      dateHeure: interview.dateHeure,
      dureeMinutes: interview.dureeMinutes,
      canal: interview.canal,
      lieu: interview.lieu,
      meetingUrl: interview.meetingUrl,
    });
  }

  return { traitees: lignesEchec.length };
}
