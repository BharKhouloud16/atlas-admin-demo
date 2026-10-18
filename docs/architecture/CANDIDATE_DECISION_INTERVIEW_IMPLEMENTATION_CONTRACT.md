# ATLAS — CANDIDATE DECISION + INTERVIEW IMPLEMENTATION CONTRACT

Document de conception d'implémentation uniquement. Aucun code, migration,
API, UI, test, service, provider ou composant n'a été créé ou modifié pour
produire ce document.

Sources d'autorité, dans l'ordre : décisions ATLAS verrouillées > CTO
Validation (`CANDIDATE_DECISION_INTERVIEW_CTO_VALIDATION.md`) > architecture
existante réelle (re-vérifiée ci-dessous, jamais supposée) > Design System
ATLAS > UX/accessibilité > skills design > préférence de l'agent.

---

## 1. Les 7 objets — spécification complète

Conventions Prisma reprises telles qu'observées dans le dépôt (jamais
inventées) : `id String @id @default(cuid())` ; acteurs identifiés par
email (`xxxParEmail`), jamais par un nouveau mécanisme d'identité ;
append-only via `supersedesId String? @unique` + relation auto-référente
nommée (pattern exact de `FinancialResult`) ; invariants d'unicité
appliqués en `Serializable`+retry `P2034` plutôt qu'en contrainte DB
partielle (pattern exact de `MissionAssignment` — confirmé en relisant
`lib/mission/assignment.ts:118-136` : le document précédent ne doit pas
supposer un index partiel, ce service applique la vérification *dans* la
transaction, jamais via un `@@unique` partiel que Prisma ne supporte pas
nativement).

### 1.1 `CandidateSelection`

```prisma
enum CandidateSelectionStatut { ACTIVE RETIREE }

model CandidateSelection {
  id                String   @id @default(cuid())
  shortlistEntree   ShortlistEntree @relation(fields: [shortlistEntreeId], references: [id], onDelete: Restrict)
  shortlistEntreeId String
  demandeTalent     DemandeTalent   @relation(fields: [demandeTalentId], references: [id], onDelete: Cascade)
  demandeTalentId   String   // dénormalisé depuis shortlistEntree.demandeId — même pattern que SolutionOption.clientId dénormalisé depuis need.clientId, pour une vérification tenant à une seule lecture
  statut            CandidateSelectionStatut @default(ACTIVE)
  selectedByEmail   String
  selectedAt        DateTime @default(now())
  retireeParEmail   String?
  retireeLe         DateTime?
  createdAt         DateTime @default(now())

  interviews        Interview[]

  @@index([demandeTalentId])
  @@index([shortlistEntreeId])
}
```

- **Nullable/non-nullable** : tout champ `xxxLe`/`xxxParEmail` lié au
  retrait est nullable (état initial = jamais retiré).
- **Tenant** : via `demandeTalentId` → `DemandeTalent.clientId`.
- **Ownership** : créée par CLIENT (ou ADMIN pour compte du Client, §11).
- **Immutabilité** : `statut` est le seul champ mutable après création ;
  tout le reste est figé (même discipline que `ShortlistEntree`).
- **Lifecycle** : `ACTIVE → RETIREE` (jamais l'inverse — un retrait suivi
  d'un regret crée une **nouvelle** `CandidateSelection` sur le même
  `shortlistEntreeId`, jamais une réactivation de l'ancienne ligne).
- **Suppression** : jamais de `DELETE` physique. `onDelete: Restrict` sur
  `shortlistEntreeId` — une `ShortlistEntree` référencée par une
  `CandidateSelection` ne peut jamais être supprimée (elle ne l'est de toute
  façon jamais dans l'existant).
- **Audit** : `candidate.selection.created`, `candidate.selection.cancelled`.
- **Source de vérité** : l'identité du candidat reste `ShortlistEntree.profilId`
  (jamais copiée ici).
- **Invariant Serializable+retry** : au plus une `CandidateSelection(statut: ACTIVE)`
  par `shortlistEntreeId` — vérifié par relecture dans la transaction avant
  création, jamais une contrainte DB (aucun `@@unique` partiel nécessaire ;
  Prisma ne le supporte pas nativement et ce n'est pas le pattern déjà en
  usage dans le dépôt pour ce type d'invariant).

### 1.2 `Interview`

```prisma
enum InterviewStatut { PLANIFIE CONFIRME TERMINE ANNULE ABSENT }
enum InterviewCanal  { VIDEO TELEPHONE PRESENTIEL AUTRE }

model Interview {
  id                   String    @id @default(cuid())
  candidateSelection   CandidateSelection @relation(fields: [candidateSelectionId], references: [id], onDelete: Restrict)
  candidateSelectionId String
  statut               InterviewStatut @default(PLANIFIE)
  canal                InterviewCanal
  dateHeure            DateTime  // stockée en UTC
  dureeMinutes         Int
  timezoneSaisie       String    // nom IANA, ex. "Europe/Paris" — affichage uniquement, dateHeure reste la source de vérité en UTC
  lieu                 String?   // si canal = PRESENTIEL
  objectif             String?   // texte libre, décision 7 — jamais un enum fermé
  meetingProvider      String?
  meetingUrl           String?
  meetingExternalId    String?
  createdByEmail       String
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  annuleParEmail       String?
  annuleLe             DateTime?
  motifAnnulation      String?

  participants         InterviewParticipant[]
  evaluations          InterviewEvaluation[]

  @@index([candidateSelectionId])
}
```

- **Tenant** : via `candidateSelectionId` → `demandeTalentId` → `clientId`.
- **Ownership** : créé par ADMIN (orchestration), jamais par le Client
  directement (le Client sélectionne, l'Admin planifie — cohérent avec son
  rôle d'organisation déjà établi ailleurs dans ATLAS).
- **Immutabilité** : `dateHeure`/`dureeMinutes`/`canal`/`lieu` sont
  réécrits uniquement via un **rescheduling explicite** (même ligne mise à
  jour + `updatedAt`, **pas** une nouvelle ligne — contrairement à
  `CandidateSelection`/`InterviewEvaluation` — car un Interview planifié
  puis déplacé reste conceptuellement le même événement, pas un nouveau ;
  l'historique du déplacement est porté par l'audit `interview.rescheduled`,
  pas par une chaîne de lignes).
- **Lifecycle (CTO Validation §7, verrouillé)** :
  `PLANIFIE → CONFIRME` (quand **tous** les participants `CANDIDAT`/
  `estOrganisateur: true` ont `statutInvitation: ACCEPTEE` — jamais une
  majorité, jamais un score, voir §9) ; `CONFIRME → TERMINE` (constatation
  Admin manuelle après la date) ; `(PLANIFIE|CONFIRME) → ANNULE` (refus du
  candidat/organisateur, ou annulation Admin) ; `(PLANIFIE|CONFIRME) → ABSENT`
  (constatation Admin, le jour J, qu'un participant requis ne s'est pas
  présenté). **`EN_COURS` n'existe pas** (décision verrouillée, aucune
  intégration live). Un `Interview` `ANNULE`/`ABSENT`/`TERMINE` est **terminal** —
  jamais réutilisé ; une répétition crée un **nouvel** `Interview` référençant
  la même `CandidateSelection`.
- **Suppression** : jamais. `onDelete: Restrict` sur `candidateSelectionId`.
- **Audit** : `interview.created`, `interview.rescheduled`, `interview.cancelled`,
  `interview.completed`. (`interview.invited`/`interview.accepted`/
  `interview.declined` sont portés par `InterviewParticipant`, §1.3.)
- **Données sensibles** : `meetingUrl` n'est jamais loggée en clair dans
  l'audit (`detail` de `journaliser()` ne doit jamais contenir `meetingUrl`
  ni l'identité des participants autres que leur email, déjà requis
  ailleurs — voir §10).

### 1.3 `InterviewParticipant`

```prisma
enum InterviewParticipantRole { CANDIDAT CLIENT ADMIN_RECRUTEUR INTERVIEWEUR_INTERNE }
enum StatutInvitation        { EN_ATTENTE ENVOYEE ACCEPTEE REFUSEE CRENEAU_ALTERNATIF_PROPOSE }

model InterviewParticipant {
  id                  String @id @default(cuid())
  interview           Interview @relation(fields: [interviewId], references: [id], onDelete: Cascade)
  interviewId         String
  role                InterviewParticipantRole
  emailParticipant    String
  profilId            String?   // rempli uniquement si le participant est un Profil ATLAS (candidat ou intervieweur interne)
  fonctionDeclaree    String?   // texte libre, ex. "Lead technique" — jamais une 5e valeur d'enum (CTO Validation §7)
  estOrganisateur     Boolean  @default(false)
  telephoneInterview  String?   // capture scopée à CET Interview uniquement, jamais sur Profil (CTO Validation §5)
  statutInvitation    StatutInvitation @default(EN_ATTENTE)
  invitationEnvoyeeLe DateTime?
  reponseLe           DateTime?
  messageReponse      String?   // ex. "proposer un autre créneau", texte libre
  createdAt           DateTime @default(now())

  reminders           InterviewReminder[]
  calendarSync        CalendarSyncRecord?

  @@unique([interviewId, emailParticipant])
}
```

- **Tenant** : via `interviewId`.
- **Ownership** : créé par ADMIN à la création de l'`Interview` (liste des
  participants fournie à la création, jamais ajoutée séparément par un
  autre rôle).
- **Immutabilité** : `role`/`emailParticipant`/`profilId`/`estOrganisateur`
  figés après création (modifier un participant = retirer + recréer, même
  discipline que partout ailleurs). `statutInvitation`/`reponseLe`/
  `messageReponse` sont les seuls champs mutables, exclusivement via la
  réponse du participant lui-même (token signé ou session authentifiée).
- **Invariant Serializable+retry** : exactement un `estOrganisateur: true`
  par `interviewId` — même pattern que `MissionAssignment.estResponsablePrincipal`,
  vérifié en transaction `Serializable` à la création.
- **Audit** : `interview.invited` (à l'envoi), `interview.accepted`,
  `interview.declined`.

### 1.4 `InterviewEvaluation`

```prisma
enum AppreciationCritere      { POSITIF NEUTRE NEGATIF }
enum RecommandationEvaluation { RECOMMANDE RECOMMANDE_AVEC_RESERVES NON_RECOMMANDE }

model InterviewEvaluation {
  id                 String @id @default(cuid())
  interview          Interview @relation(fields: [interviewId], references: [id], onDelete: Restrict)
  interviewId        String
  evaluateurEmail    String
  evaluateurRole     InterviewParticipantRole // snapshot au moment de l'évaluation — détermine la visibilité (§10)
  criteres           Json      // [{critere: string, observation: string, appreciation: AppreciationCritere}] — "critere" limité au vocabulaire fermé (facteurs Matching V2 + set qualitatif documenté, jamais une nouvelle taxonomie de compétences techniques)
  observations       String?
  recommandation     RecommandationEvaluation
  commentairesLibres String?
  supersedesId       String?   @unique
  supersedes         InterviewEvaluation? @relation("InterviewEvaluationSuccession", fields: [supersedesId], references: [id])
  supersededBy       InterviewEvaluation? @relation("InterviewEvaluationSuccession")
  createdAt          DateTime  @default(now())

  @@index([interviewId])
}
```

- **Tenant** : via `interviewId`.
- **Ownership** : créée uniquement par un `InterviewParticipant` ayant
  réellement `statutInvitation: ACCEPTEE` sur **cet** `Interview` (vérifié
  à l'écriture — jamais une permission globale "peut évaluer").
  `evaluateurRole` est un **snapshot**, jamais relu dynamiquement depuis
  `InterviewParticipant` (même discipline que `MissionCapabilityLink.capability`,
  snapshot figé).
- **Immutabilité** : totale. Correction = nouvelle ligne via `supersedesId`,
  jamais une réécriture (pattern exact de `FinancialResult`).
- **Visibilité (CTO Validation §11, verrouillée)** : une évaluation dont
  `evaluateurRole = CLIENT` est visible par ce même Client + ADMIN. Une
  évaluation dont `evaluateurRole ∈ {ADMIN_RECRUTEUR, INTERVIEWEUR_INTERNE}`
  reste **Admin-only** par défaut — jamais de visibilité croisée
  automatique entre évaluateurs.
- **Audit** : `interview.evaluated`.
- **Invariant verrouillé** : aucune `InterviewEvaluation` ne déclenche
  automatiquement une `CandidateFinalDecision` — aucun code ne doit lier
  les deux autrement que par lecture dans la vue Comparison (§1.6-bis).

### 1.5 `CandidateFinalDecision` (+ `CandidateFinalDecisionEntree`)

```prisma
enum CandidateFinalDecisionStatutEntree { RETENU NON_RETENU }

model CandidateFinalDecision {
  id                             String @id @default(cuid())
  demandeTalent                  DemandeTalent @relation(fields: [demandeTalentId], references: [id], onDelete: Restrict)
  demandeTalentId                String
  decideParEmail                 String
  communiqueParClientHorsSysteme Boolean  @default(false) // CTO Validation §13 — obligatoire si décideParEmail est un Admin
  canalHorsSysteme               String?
  supersedesId                   String?   @unique
  supersedes                     CandidateFinalDecision? @relation("CandidateFinalDecisionSuccession", fields: [supersedesId], references: [id])
  supersededBy                   CandidateFinalDecision? @relation("CandidateFinalDecisionSuccession")
  createdAt                      DateTime  @default(now())

  entrees                        CandidateFinalDecisionEntree[]

  @@index([demandeTalentId])
}

model CandidateFinalDecisionEntree {
  id                   String @id @default(cuid())
  decision             CandidateFinalDecision @relation(fields: [decisionId], references: [id], onDelete: Cascade)
  decisionId           String
  candidateSelection   CandidateSelection @relation(fields: [candidateSelectionId], references: [id], onDelete: Restrict)
  candidateSelectionId String
  statut               CandidateFinalDecisionStatutEntree
  justification        String? // requise si statut = NON_RETENU (validation service, pas DB)

  @@unique([decisionId, candidateSelectionId])
}
```

- **Tenant** : via `demandeTalentId`.
- **Ownership (CTO Validation §13, MODIFIED et verrouillée)** :
  `decideParEmail` doit être un email CLIENT, **sauf** si
  `communiqueParClientHorsSysteme: true` **et** `canalHorsSysteme` renseigné
  (cas Admin enregistrant pour compte du Client — jamais une décision
  Admin autonome). Validé au niveau service, jamais en DB.
- **Immutabilité** : totale, append-only via `supersedesId`.
- **Invariant Serializable+retry** : au plus une `CandidateFinalDecision`
  "active" (non-supersédée) par `demandeTalentId` — vérifié en transaction.
- **Audit** : `candidate.final_decision.recorded` (action unique, que la
  décision vienne du Client via l'UI ou de l'Admin pour son compte — le
  canal est capturé par `communiqueParClientHorsSysteme`, jamais par une
  action d'audit distincte, CTO Validation §16).
- **Relation avec Proposal/Mission** : **aucune**. Ce modèle ne crée jamais
  de `Mission` ni de `Proposal` directement — confirmé verrouillé.

### 1.6 `InterviewReminder`

```prisma
enum InterviewReminderStatutEnvoi { PLANIFIE ENVOYE ANNULE ECHEC }

model InterviewReminder {
  id                     String @id @default(cuid())
  interviewParticipant   InterviewParticipant @relation(fields: [interviewParticipantId], references: [id], onDelete: Cascade)
  interviewParticipantId String
  delaiAvantMinutes      Int
  declencheA             DateTime  // = interview.dateHeure - delaiAvantMinutes, calculé et stocké à la création pour une requête de polling efficace
  statutEnvoi            InterviewReminderStatutEnvoi @default(PLANIFIE)
  envoyeLe               DateTime?
  createdAt              DateTime  @default(now())

  @@unique([interviewParticipantId, delaiAvantMinutes])
  @@index([declencheA, statutEnvoi])
}
```

- **Tenant** : via `interviewParticipantId`.
- **Ownership** : créé automatiquement par le service de planification à la
  création de l'`Interview` (pas par un acteur humain).
- **Lifecycle** : `PLANIFIE → ENVOYE | ANNULE | ECHEC`. `ANNULE` si
  l'`Interview`/le `InterviewParticipant` change de statut avant déclenchement
  (§1.6-ter). Un rescheduling supprime les lignes `PLANIFIE` existantes
  (hard-delete acceptable ici — ce sont des artefacts de planification
  internes, pas un fait métier/audité en soi, contrairement aux autres
  objets) et en recrée pour la nouvelle `dateHeure`.
- **Audit** : `interview.reminder_sent` (uniquement sur `ENVOYE`, pas de
  bruit pour `PLANIFIE`/`ANNULE`).

### 1.7 `CalendarSyncRecord`

```prisma
enum CalendarSyncStatut { NON_CONNECTE EN_ATTENTE SUCCES ECHEC ANNULE_EXTERNE }

model CalendarSyncRecord {
  id                     String @id @default(cuid())
  interviewParticipant   InterviewParticipant @relation(fields: [interviewParticipantId], references: [id], onDelete: Cascade)
  interviewParticipantId String   @unique
  provider               String?
  externalEventId        String?
  statutSync             CalendarSyncStatut @default(NON_CONNECTE)
  dernierEssaiLe         DateTime?
  erreurDetail           String?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}
```

- **EXTERNAL INTEGRATION** — découplée du domaine ATLAS.
- **Tenant** : via `interviewParticipantId`.
- **Immutabilité** : `statutSync`/`externalEventId`/`erreurDetail` mutables
  (une seule ligne par participant, mise à jour in-place — contrairement
  aux objets de décision/évaluation, ceci est un **état technique**, pas un
  fait métier, append-only non nécessaire ici).
- **Audit** : `calendar.sync.requested`, `calendar.sync.failed` (succès non
  audité individuellement — pur bruit technique, `statutSync: SUCCES`
  suffit comme état consultable).
- **Invariant absolu** : aucune lecture de `statutSync` ne doit jamais
  influencer `Interview.statut`/`InterviewParticipant.statutInvitation` —
  vérifié par construction (aucune FK inverse, aucun service Interview ne
  lit `CalendarSyncRecord`).

---

## 2. Frontière avec l'existant

| Composant existant | Relation | Modification ? |
|---|---|---|
| `ClientNeed` | Aucune relation directe (la chaîne passe par `DemandeTalent`) | **Aucune** |
| `DemandeTalent` | `CandidateFinalDecision.demandeTalentId`, `CandidateSelection.demandeTalentId` (lecture/référence uniquement) | **Aucune** — jamais un champ ajouté sur `DemandeTalent` |
| `ShortlistEntree` | `CandidateSelection.shortlistEntreeId` (référence, `onDelete: Restrict`) | **Aucune** — jamais un champ ajouté, jamais un statut modifié par ce lot |
| Matching V2 | Aucun appel, aucune donnée relue pour recalculer un score | **Aucune** — Matching V2 n'est jamais appelé par ce nouveau domaine |
| `Profil` | `InterviewParticipant.profilId` (référence optionnelle) | **Aucune** — en particulier, jamais de champ téléphone ajouté (CTO Validation §5) |
| `Mission`/`MissionAssignment` | Aucune relation — `CandidateFinalDecision` ne crée jamais de `Mission` | **Aucune** |
| `Learning`/`Decision Context` | Points de raccordement documentés uniquement (Design Contract §16) | **Aucune** |
| `RoleProfile` | Aucune relation directe (chaîne : `RoleProfile → ClientNeed`, en amont) | **Aucune** |

**Confirmation explicite** : aucun nouveau Staffing Engine, aucun nouveau
Matching Engine, aucun recalcul de score Matching — les 7 objets consomment
des faits déjà produits par l'existant, jamais une nouvelle logique de
scoring.

## 3. CandidateSelection — cycle complet

```
ShortlistEntree(VALIDEE)
      ↓ POST (Client crée une CandidateSelection)
CandidateSelection(ACTIVE)
      ↓ (optionnel) DELETE/retrait
CandidateSelection(RETIREE)  — ShortlistEntree inchangée, jamais réécrite
```

- **Création** : `POST /api/client/talent-selection/demandes/[demandeId]/selections`
  (CLIENT), body `{shortlistEntreeId}`. Vérifie `shortlistEntree.statut === "VALIDEE"`
  et appartenance à la `DemandeTalent` du Client appelant.
- **Statut** : `ACTIVE`/`RETIREE`, voir §1.1.
- **Annulation** : `DELETE /api/client/talent-selection/selections/[selectionId]`
  (CLIENT, propriétaire uniquement). Ne touche jamais `ShortlistEntree`.
- **Audit** : `candidate.selection.created`/`candidate.selection.cancelled`.
- **Visibilité** : CLIENT voit ses propres sélections ; ADMIN voit toutes
  les sélections de ses `DemandeTalent`.
- **Idempotence** : une tentative de double-sélection sur la même
  `shortlistEntreeId` déjà `ACTIVE` échoue (409), vérifié en transaction.

## 4. Interview — modèle et lifecycle

Voir §1.2 pour le schéma complet. Résumé lifecycle :

```
PLANIFIE --(tous CANDIDAT/organisateur ACCEPTEE)--> CONFIRME --(constat Admin)--> TERMINE
   |                                                    |
   +--(refus CANDIDAT/organisateur, ou annulation Admin)-+--> ANNULE
   |
   +--(constat Admin, absence le jour J)-----------------------> ABSENT
```

Tout échec/répétition crée un **nouvel** `Interview`, jamais une réutilisation
d'une ligne terminale (`TERMINE`/`ANNULE`/`ABSENT`).

## 5. Participants

| Rôle | Peut être | Identité | `fonctionDeclaree` typique |
|---|---|---|---|
| `CANDIDAT` | Le candidat (`Profil`) | `profilId` requis | — |
| `CLIENT` | Un représentant du Client, y compris un "intervieweur technique" côté Client | `profilId` null, `emailParticipant` requis | "Lead technique", "RH", etc. (texte libre) |
| `ADMIN_RECRUTEUR` | Un membre ATLAS organisant/participant | `profilId` null ou un compte interne | — |
| `INTERVIEWEUR_INTERNE` | Un `Profil` ATLAS (ingénieur) participant comme intervieweur technique interne | `profilId` requis | — |

Le rôle "intervieweur technique" validé par le CTO (CTO Validation §7) est
donc **implémentable explicitement** via `role: CLIENT` + `fonctionDeclaree`
pour le cas côté-Client (le cas réel attendu), et `role: INTERVIEWEUR_INTERNE`
pour un cas côté-ATLAS — **aucune 5ᵉ valeur d'enum**.

## 6. Identité / Confidentialité — implémentation du seuil

```
Avant CandidateSelection
→ CandidatAnonyme (9 champs existants, ingenieurId pseudonymisé via idPublicIngenieur) — INCHANGÉ

Après CandidateSelection (ACTIVE)
→ GET /api/client/talent-selection/selections/[selectionId]/profil
  retourne { nom, prenom } UNIQUEMENT — jamais email/téléphone/CV/tjm*
```

**Interdictions garanties par construction** :
- **IDOR** : `selectionId` résout l'identité via `CandidateSelection →
  ShortlistEntree → Profil`, jamais un `profilId` accepté en paramètre —
  même discipline que `besoin/matcher` existant.
- **Fuite via logs** : aucun `console.log`/`journaliser().detail` ne doit
  jamais contenir `nom`/`prenom`/`email` candidat en clair — seul `cible`
  (l'id, pas la valeur) est journalisé, même discipline que l'existant.
- **Fuite via emails** : §1.2, les emails envoyés aux autres participants
  ne révèlent jamais les coordonnées des autres participants, seulement
  leurs rôles (Design Contract §8, confirmé).
- **Fuite via calendar metadata** : `CalendarSyncRecord` ne stocke jamais le
  contenu complet de l'événement externe (§1.7, §23).
- **Fuite via URLs vidéo** : `meetingUrl` n'est exposée qu'aux participants
  de **cet** `Interview` précis (jamais une URL globale/réutilisable entre
  Interviews).

## 7. Final Decision — implémentation de la règle verrouillée

États exacts : `RETENU | NON_RETENU` par `CandidateFinalDecisionEntree`,
jamais un état composite. Transitions : aucune — une ligne `entrees` n'est
jamais modifiée, une reconsidération crée une **nouvelle**
`CandidateFinalDecision` (via `supersedesId`) avec un nouveau jeu
d'`entrees` complet.

**Traçabilité** : `decideParEmail` + `communiqueParClientHorsSysteme` +
`canalHorsSysteme` + `createdAt` = traçabilité complète, auditée
(`candidate.final_decision.recorded`), liée au candidat (`candidateSelectionId`)
et au contexte commercial (`demandeTalentId`).

**Compatibilité Proposal future** : `CandidateFinalDecision` expose
`id`/`entrees[].candidateSelectionId`/`entrees[].statut` — champs suffisants
pour qu'un futur `Proposal` référence cette décision par id, **sans qu'aucun
champ préparatoire ne soit ajouté ici** (confirmé : aucune colonne
`proposalId`/`missionDraftId` dans ce schéma).

## 8. Critère CONFIRME — implémentation exacte

```ts
// Pseudo-code de la règle, jamais un score/une moyenne/une IA.
function peutConfirmer(interview: Interview, participants: InterviewParticipant[]): boolean {
  const requis = participants.filter(p => p.role === "CANDIDAT" || p.estOrganisateur);
  return requis.length > 0 && requis.every(p => p.statutInvitation === "ACCEPTEE");
}
```

Chaque condition (candidat accepté, organisateur accepté) est représentée
explicitement par le filtre `requis` ci-dessus — **aucune agrégation
numérique**, **aucun seuil de pourcentage**, **aucune IA**. Appelé après
chaque mise à jour de `statutInvitation` (transition déclenchée par
événement, pas par un job périodique).

## 9. Evaluation — récapitulatif implémentation

Voir §1.4 pour le schéma. Règle verrouillée : **Evaluation ≠ Decision** —
`InterviewEvaluation` n'a **aucune** relation entrante depuis
`CandidateFinalDecision` (la Comparison, §12, les lit toutes les deux côte
à côte en lecture, mais aucune écriture ne chaîne automatiquement l'une à
l'autre). Aucun champ `declencheDecisionAutomatique` ou équivalent n'existe
— confirmé absent par construction.

## 10. Email — implémentation

| Template | Événement déclencheur | Destinataire(s) |
|---|---|---|
| `envoyerEmailInvitationEntretien` | `InterviewParticipant` créé | Ce participant |
| `envoyerEmailConfirmationEntretien` | `Interview.statut → CONFIRME` | Tous les participants |
| `envoyerEmailRefusEntretien` | `statutInvitation → REFUSEE` | Admin organisateur (notification interne) |
| `envoyerEmailModificationEntretien` | Rescheduling | Tous les participants, nouvelle date |
| `envoyerEmailAnnulationEntretien` | `Interview.statut → ANNULE` | Tous les participants |
| `envoyerEmailRappelEntretien` | `InterviewReminder → ENVOYE` | Le participant concerné uniquement |

Toutes best-effort, pattern `lib/email.ts` existant (try/catch, jamais
bloquant). **Idempotence** : chaque envoi correspond à un passage de statut
précis (ex. un seul `envoyerEmailConfirmationEntretien` par passage réel à
`CONFIRME` — pas de renvoi si le statut ne change pas). **Retry** : aucun
retry automatique d'email (même discipline que l'existant — un échec est
loggé, jamais retenté silencieusement, l'Admin peut relancer manuellement si
nécessaire). **Audit** : non systématique (l'envoi email n'est pas en soi un
fait métier — c'est la transition de statut sous-jacente qui est auditée,
ex. `interview.invited`, pas `email.sent`).

**Invariant absolu, confirmé respecté par construction** : un échec d'envoi
n'empêche jamais la création/mise à jour de l'entité métier — l'email est
toujours envoyé **après** la transaction qui persiste l'état, jamais dans la
même transaction.

## 11. Calendar — implémentation

**Trigger** : `statutInvitation → ACCEPTEE` (sur un `InterviewParticipant`)
déclenche une tentative de sync pour **ce participant uniquement**.

**Provider boundary** : `CalendarSyncRecord.provider` reste une chaîne
ouverte ; aucun appel réel à un fournisseur n'est implémenté dans ce lot (le
mandat §15 du Design Contract le confirme : aucune intégration réelle). Le
mécanisme de déclenchement (ci-dessous) doit être prêt pour qu'un futur lot
d'intégration réelle s'y branche sans redesign.

**Idempotence/update/reschedule/cancellation** :
- Création : si `CalendarSyncRecord` n'existe pas encore pour ce participant,
  en créer un (`statutSync: EN_ATTENTE`), puis tenter la sync.
- Update (reschedule) : réutiliser `externalEventId` existant pour une mise
  à jour externe, jamais une recréation — même ligne `CalendarSyncRecord`
  mise à jour.
- Cancellation : appel d'annulation externe via `externalEventId`, puis
  `statutSync: ANNULE_EXTERNE` (jamais de suppression physique de la ligne).
- Retry : un job de resynchronisation (voir §16) retente les lignes
  `statutSync: ECHEC`, avec un compteur de tentatives borné (même discipline
  `MAX_TENTATIVES` que les transactions `Serializable` existantes, par
  analogie, pas le même mécanisme).
- **Failure** : `statutSync: ECHEC` + `erreurDetail`, audité
  (`calendar.sync.failed`), **n'altère jamais** `Interview.statut`.

**Timezone** : l'événement calendrier externe (futur) doit être créé avec
l'heure UTC de `Interview.dateHeure`, laissant le client calendrier du
participant afficher sa propre timezone locale — `timezoneSaisie` sur
`Interview` reste informatif pour l'affichage ATLAS, jamais transmis comme
donnée d'autorité au fournisseur externe (qui gère sa propre conversion).

## 12. Reminders — implémentation

**Nombre/timing** : 2 par participant par défaut, `delaiAvantMinutes ∈ {1440, 60}`
("24h + 1h", CTO Validation §10), configurable (pas en dur dans le code
métier — une constante de configuration, pas une valeur câblée dans chaque
service).

**Génération** : à la création de l'`Interview` (une fois la `dateHeure`
connue), une ligne `InterviewReminder` par `(participant, délai)`.

**Déclenchement** : un **unique** point d'entrée interne,
`POST /api/internal/interview-reminders/process`, protégé par un en-tête à
secret partagé (même esprit que `SEED_TOKEN` déjà utilisé pour les scripts
d'amorçage de ce dépôt — pas un nouveau mécanisme d'auth). Appelé
périodiquement par l'infrastructure d'hébergement (cron externe à ATLAS,
**pas un scheduler générique construit dans ce lot** — confirmé conforme à
l'interdiction explicite). Ce point d'entrée sélectionne les lignes
`statutEnvoi: PLANIFIE` dont `declencheA <= now()`, revérifie le statut de
l'`Interview`/`InterviewParticipant` **au moment du traitement**, envoie
l'email, marque `ENVOYE` (ou `ECHEC` si l'email échoue — distinct d'`ANNULE`).

**Cancellation/rescheduling** : voir §1.6 — hard-delete des lignes
`PLANIFIE` obsolètes, recréation pour la nouvelle date.

**Idempotence** : `@@unique([interviewParticipantId, delaiAvantMinutes])` +
le traitement ne retraite jamais une ligne déjà `ENVOYE`/`ANNULE`/`ECHEC`.

**Failure** : un échec d'envoi de rappel est isolé par ligne — n'affecte
jamais les autres rappels ni l'`Interview` lui-même.

## 13. Video — abstraction minimale

```
Interview.canal = VIDEO
        ↓
meetingProvider: String? / meetingUrl: String? / meetingExternalId: String?
        ↓ (futur, hors scope)
provider réel (jamais imposé ici)
```

Données réellement nécessaires, et seulement celles-ci : `meetingUrl` (le
lien à communiquer), `meetingExternalId` (référence technique pour un futur
provider), `provider` (nom ouvert). Aucun statut technique supplémentaire
n'est nécessaire dans ce lot — "connecté/déconnecté" n'a de sens qu'une fois
un vrai provider branché, donc non modélisé maintenant (ne pas créer de
champ qui ne servirait à rien avant son intégration réelle, §5 du mandat :
"Avant de proposer un champ, vérifie qu'il n'existe pas déjà ailleurs" et,
par extension, qu'il serve réellement maintenant).

## 14. Transactions / Idempotence — carte complète

| Opération | Transaction | Isolation | Retry | Clé d'unicité |
|---|---|---|---|---|
| Création `CandidateSelection` | Oui | Serializable | P2034 | Relecture `statut: ACTIVE` par `shortlistEntreeId` dans la transaction |
| Création `Interview` + `InterviewParticipant[]` | Oui | Serializable | P2034 | Relecture `estOrganisateur` unique par `interviewId` dans la transaction |
| Réponse à une invitation (`statutInvitation`) | Oui (simple update, pas de concurrence multi-lignes) | Default | Non nécessaire | `@@unique([interviewId, emailParticipant])` empêche le doublon de participant en amont |
| `CalendarSyncRecord` création/update | Oui | Default (une seule ligne par participant, `@@unique`) | Retry applicatif (job), pas `P2034` | `@@unique([interviewParticipantId])` |
| `InterviewReminder` création | Oui (batch à la création de l'Interview) | Default | Non nécessaire | `@@unique([interviewParticipantId, delaiAvantMinutes])` |
| `CandidateFinalDecision` création | Oui | Serializable | P2034 | Relecture "au plus une décision active par `demandeTalentId`" dans la transaction |

L'idempotence est démontrable par les contraintes `@@unique` citées +
relecture en transaction — jamais seulement déclarée en commentaire.

## 15. API — endpoints (aucune implémentation)

### Client-facing (nouveau namespace `app/api/client/talent-selection/`)

| Méthode/Route | Acteur | Input | Output | Erreurs |
|---|---|---|---|---|
| `GET /demandes/[demandeId]/shortlist` | CLIENT | — | `CandidatAnonyme[]` (`ShortlistEntree.statut = VALIDEE` uniquement, filtré en requête Prisma) | 403 (rôle), 404 (autre tenant/inexistant) |
| `POST /demandes/[demandeId]/selections` | CLIENT | `{shortlistEntreeId}` | `CandidateSelection` | 404, 409 (déjà `ACTIVE`) |
| `DELETE /selections/[selectionId]` | CLIENT | — | `{statut: "RETIREE"}` | 403, 404 |
| `GET /selections/[selectionId]/profil` | CLIENT | — | `{nom, prenom}` | 403, 404 |
| `GET /selections/[selectionId]/interviews` | CLIENT | — | `Interview[]` (sans champs internes `meetingExternalId`) | 403, 404 |
| `POST /interviews/[interviewId]/evaluations` | CLIENT (si participant ACCEPTEE) | `{criteres, observations, recommandation, commentairesLibres}` | `InterviewEvaluation` | 403 (non-participant) |
| `GET /demandes/[demandeId]/comparison` | CLIENT | — | Vue agrégée (lecture pure) | 403, 404 |
| `POST /demandes/[demandeId]/final-decision` | CLIENT | `{entrees: [{candidateSelectionId, statut, justification?}]}` | `CandidateFinalDecision` | 400 (justification manquante sur NON_RETENU) |

### Sans session (jeton signé, pattern `verifier-email`)

| Méthode/Route | Input | Output |
|---|---|---|
| `POST /api/interviews/[interviewId]/participants/[participantId]/reponse?token=...` | `{reponse: "ACCEPTEE"|"REFUSEE", messageReponse?}` | `{statutInvitation}` |

### Admin-facing (extension du namespace existant `app/api/talent/demandes/[id]/`)

| Méthode/Route | Acteur | Input | Output |
|---|---|---|---|
| `POST /interviews` | ADMIN | `{candidateSelectionId, canal, dateHeure, dureeMinutes, timezoneSaisie, lieu?, objectif?, participants: [...]}` | `Interview` |
| `PATCH /interviews/[interviewId]` | ADMIN | `{action: "reschedule"|"cancel", ...}` | `Interview` |
| `POST /interviews/[interviewId]/evaluations` | ADMIN/`INTERVIEWEUR_INTERNE` participant | idem Client | `InterviewEvaluation` |
| `POST /final-decision` | ADMIN | `{entrees: [...], communiqueParClientHorsSysteme: true, canalHorsSysteme}` | `CandidateFinalDecision` |

### Interne (job trigger)

| Méthode/Route | Acteur | Protection |
|---|---|---|
| `POST /api/internal/interview-reminders/process` | Cron externe | En-tête secret partagé (pattern `SEED_TOKEN`) |

Chaque route : validation Zod systématique (pattern déjà en usage partout
dans le dépôt), tenant check via `session.clientId`/`DemandeTalent`,
RBAC via le même garde répété `session.role !== "X"` déjà en usage, 404
jamais distingué d'une inexistence réelle (même convention), audit via
`journaliser()`.

## 16. UI / UX — structure (aucun code)

Parcours repris du Design Contract §19, confirmé sans modification
nécessaire à ce stade — réutilisation de `components/client/primitives.tsx`
(`Card`/`Section`/`Badge`/`Bouton`, pas de Modal/Dialog introduit), esthétique
alignée sur `SolutionsBesoin.tsx`/`CandidatCard` existants. Principes :
clarté, hiérarchie, efficacité, confiance — pas de card-grid superflu, pas
de glassmorphism/gradients décoratifs, pas d'icônes répétées dans des
carrés colorés (garde-fou `unslop-ui`, jamais au-dessus d'une contrainte
métier). Aucun token arbitraire créé — cohérence avec le style inline déjà
dominant côté Client.

## 17. Données personnelles

| Donnée | Pourquoi elle existe | Qui peut la lire | Conservation | Exposition interdite |
|---|---|---|---|---|
| Identité (nom/prénom) | Organiser un entretien réel | Client (post-sélection), Admin | Durée `DemandeTalent`/Mission | Avant sélection |
| Email candidat | Invitation | Admin/système | Idem | Jamais au Client directement (toujours via le flux email, jamais affiché en clair côté Client) |
| `telephoneInterview` | Canal TELEPHONE uniquement, si renseigné | Admin, participants de cet Interview | Scope strict à cet Interview | Jamais copié sur `Profil` |
| `timezoneSaisie` | Affichage correct de l'heure | Tous les participants de l'Interview | Idem Interview | — |
| Liens calendrier (`externalEventId`) | Idempotence de sync | Technique uniquement (jamais affiché) | Jusqu'à fin de vie de l'Interview | Jamais exposé en UI brut |
| Liens vidéo (`meetingUrl`) | Rejoindre l'entretien | Participants de cet Interview uniquement | Idem Interview | Jamais partagé hors des participants |
| `InterviewEvaluation` | Décision humaine documentée | Selon §1.4 (visibilité par rôle d'évaluateur) | Permanent (append-only) | Jamais visible par le candidat lui-même |

**Aucune donnée collectée "parce qu'elle pourrait être utile plus tard"** —
chaque champ listé ci-dessus a un usage immédiat dans ce lot, confirmé.

## 18. Migration

Entièrement additive — **aucune donnée existante modifiée**.

```
1. Enums : CandidateSelectionStatut, InterviewStatut, InterviewCanal,
   InterviewParticipantRole, StatutInvitation, AppreciationCritere,
   RecommandationEvaluation, CandidateFinalDecisionStatutEntree,
   InterviewReminderStatutEnvoi, CalendarSyncStatut
2. Tables : CandidateSelection, Interview, InterviewParticipant,
   InterviewEvaluation, CandidateFinalDecision,
   CandidateFinalDecisionEntree, InterviewReminder, CalendarSyncRecord
3. FK : toutes NEW → NEW ou NEW → EXISTING (ShortlistEntree, DemandeTalent,
   Profil) — aucune colonne ajoutée sur une table existante
4. Indexes : listés par modèle en §1
```

**Aucun backfill** — tous les nouveaux objets démarrent vides, aucune
donnée historique n'est migrée vers eux (il n'existe d'ailleurs aucune
donnée historique équivalente à migrer, confirmé par l'audit : ce domaine
était à 0 avant ce lot).

## 19. Test Contract (futur, non créé)

Reprend et précise le Design Contract §25 ; organisé exactement selon les 10
catégories du mandat (sélection, confidentialité, interview, email,
calendar, evaluation, final decision, RBAC, non-régression) — le détail
scénario par scénario est déjà couvert dans le Design Contract §25 et n'est
pas redupliqué ici ; ce contrat ajoute les points de preuve spécifiques à
l'implémentation :
- Preuve explicite que §15 (filtrage `VALIDEE`) est testé au niveau requête
  (créer une `ShortlistEntree` `REJETEE` et `SUGGEREE` dans le même test,
  vérifier qu'aucune n'apparaît).
- Preuve explicite que `CONFIRME` (§8) échoue tant qu'un participant requis
  n'a pas `ACCEPTEE` — un test par condition du filtre `requis`.
- Preuve explicite que `CandidateFinalDecision` par un Admin sans
  `communiqueParClientHorsSysteme: true` est rejetée (400).
- **Non-régression** : `tests/api/talent-fondations.spec.ts`,
  `lot15-5-client-requirement-builder.spec.ts`, et tout test touchant
  `ShortlistEntree`/`DemandeTalent` existant doit repasser sans changement —
  confirmé qu'aucun de ces fichiers n'a besoin d'être modifié puisque
  aucun comportement existant n'est altéré.

## 20. Ordre d'implémentation

```
1. Prisma / migration (les 7 objets, additifs)
2. Domaine + invariants (services purs : CandidateSelection, Interview lifecycle, critère CONFIRME)
3. Auth / tenant / confidentialité (garde-fous RBAC avant toute route réelle)
4. CandidateSelection (API + logique)
5. Interview / InterviewParticipant (API + logique, email d'invitation)
6. Evaluation
7. Final Decision
8. Email (templates restants : confirmation, refus, modification, annulation, rappel)
9. Calendar (CalendarSyncRecord + trigger, provider réel hors scope)
10. Reminder (InterviewReminder + endpoint interne de traitement)
11. Video boundary (champs déjà posés en #1, rien de supplémentaire)
12. APIs restantes (comparison, routes Admin de planification)
13. UI
14. Tests
15. Non-régression
```

Aucun changement par rapport à l'ordre suggéré par le mandat — vérifié
cohérent avec les dépendances réelles (Interview dépend de
CandidateSelection, Evaluation dépend d'Interview, Final Decision dépend de
CandidateSelection — jamais l'inverse).

## 21. Scope interdit — confirmation

Aucune modification de `Matching V2`/`DemandeTalent`/`ShortlistEntree`/
`Mission`/`MissionAssignment`/`Learning`/`Decision Context`/`Financial Engine`/
`Capability Engine`/`Agentic Runtime`/`RoleProfile`/`Proposal` n'est
nécessaire pour ce lot — confirmé par la frontière §2 : chaque relation
nouvelle pointe **depuis** un nouvel objet **vers** un objet existant,
jamais l'inverse. **Aucun BLOCKER ici.**

## 22. Les 8 conditions CTO — reprise explicite

| # | Condition (CTO Validation §21) | Mécanisme prévu | Module responsable | Test de preuve | Risque si violation |
|---|---|---|---|---|---|
| 1 | Filtrage `ShortlistEntree` au niveau requête Prisma | `where: { statut: "VALIDEE" }` dans la requête, jamais en mémoire | `GET /demandes/[demandeId]/shortlist` | §19 | Fuite de candidats REJETEE/SUGGEREE au Client |
| 2 | Test de non-fuite obligatoire avant merge | Test dédié avec fixtures `VALIDEE`+`REJETEE`+`SUGGEREE` | Suite de tests du endpoint | §19 | Idem |
| 3 | `score`/`confiance`/`motifs` jamais sérialisés côté Client | DTO explicite listant les champs autorisés, jamais un `...shortlistEntree` spread | Même endpoint | Test de forme de réponse | Fuite du raisonnement interne Admin |
| 4 | `CandidateFinalDecision` exclusivement Client, Admin en saisie seule | Validation service : `role !== CLIENT` exige `communiqueParClientHorsSysteme: true` | Service `final-decision` | §19 | Admin décide seul, sans le Client |
| 5 | `InterviewParticipant.role` reste à 4 valeurs | Enum fermé, `fonctionDeclaree` texte libre pour la nuance | Schéma Prisma | Test de validation Zod rejetant une 5e valeur | Dérive de taxonomie sans preuve |
| 6 | `CONFIRME` exige tous les participants requis `ACCEPTEE` | Fonction pure `peutConfirmer()` (§8) | Service lifecycle Interview | §19 | Confirmation prématurée |
| 7 | `InterviewEvaluation` visible selon `evaluateurRole` | Filtre explicite à la lecture, jamais un flag de partage manuel | Route de lecture Evaluation | Test de visibilité croisée | Fuite d'évaluation interne au Client |
| 8 | Les 7 autres recommandations APPROVED non réouvertes sans preuve | Ce document lui-même comme référence verrouillée | — | Revue de code référant ce contrat | Dérive architecturale silencieuse |

Aucune condition simplifiée ou omise.

## 23. Critère de sortie

Un développeur disposant de ce document, du Design Contract et de la CTO
Validation peut implémenter ce lot **sans décision métier fondamentale
restante** : les 7 objets ont des champs/types/enums exacts, les 8
conditions ont un mécanisme et un test de preuve nommés, l'ordre
d'implémentation est explicite, la frontière avec l'existant est vérifiée
non-invasive. **Aucune ambiguïté résiduelle identifiée.**

---

## CANDIDATE DECISION + INTERVIEW — IMPLEMENTATION CONTRACT

```
HEAD initial:            265f0a8be2a6d162fbaa911293ccad3691f3a58e
HEAD final:              265f0a8be2a6d162fbaa911293ccad3691f3a58e

Design Contract:         VALIDATED
CTO Validation:          VALIDATED

8 non-negotiable conditions: ALL COVERED (§22)

Architecture:             READY
Security:                 READY
Confidentiality:          READY
RBAC:                     READY
Email:                    READY
Calendar:                 READY
Interview:                READY
Final Decision:           READY

Implementation Contract:  COMPLETE

Commit: NONE
Push:   NONE
```

Après ce document : STOP. Aucun code, aucune migration, aucune API, aucune
UI créée. L'implémentation n'a pas commencé.
