# ATLAS — CANDIDATE PROPOSAL DESIGN CONTRACT

Document de conception uniquement. Aucun fichier applicatif, aucun schéma
Prisma, aucune migration, aucune route, aucune page, aucun test n'a été créé
ou modifié pour produire ce contrat. Toutes les affirmations ci-dessous sont
vérifiées directement dans le code réel du dépôt (`atlas-admin-demo`), jamais
supposées.

**Légende obligatoire** (mandat §10) — chaque affirmation structurante porte
une étiquette :
- **[CONTRAINTE EXISTANTE]** — déjà vraie dans le code/les contrats acceptés, non négociable.
- **[RECOMMANDATION]** — proposition de ce document, pas encore validée.
- **[DÉCISION CTO REQUISE]** — question dont la réponse engage l'architecture et doit être tranchée avant implémentation.
- **[QUESTION OUVERTE]** — point non bloquant pour ce contrat, mais à clarifier avant ou pendant l'implémentation.

Une recommandation n'est jamais présentée comme une décision déjà approuvée.

---

## Revue CTO — A35 (11/10/2026)

**A35 — CTO Design Validation & Contract Lock.** Les cinq arbitrages
obligatoires (D1-D5) ont été tranchés par cette revue et sont consolidés en
**§15**, avec une classification explicite par décision :

- **LOCKED** — approuvé pour la conception, n'est plus une question ouverte.
- **OPEN** — reste à trancher avant l'implémentation.
- **EXTERNAL VALIDATION REQUIRED** — validation juridique/sécurité/autre
  expertise externe requise, non bloquante pour ce document tant que la
  frontière ATLAS/externe reste explicite.
- **IMPLEMENTATION DETAIL** — choix technique à confirmer au contrat
  d'implémentation, sans remettre en cause l'invariant métier déjà verrouillé.

Cette revue **n'a modifié aucun fichier applicatif, aucun schéma, aucune
migration** — seul ce document a été corrigé, aux endroits précisément
indiqués par les arbitrages de §15. Aucun invariant de code n'a été créé ou
changé par cette phase.

**Revue complémentaire — A35.1 (11/10/2026)** : les quatre points restés
`OPEN` après A35 (champ concret anti-double-Mission, choix de pinning
A18/A19, comportement après refus pour décision supersédée, portée
minimale de la première implémentation) ont été arbitrés explicitement. Le
détail est intégré directement dans les sections concernées (§10.5, §11.2,
§11.3, §11.5 nouveau) et consolidé dans la synthèse de §15. Aucun fichier
applicatif, schéma ou migration n'a été modifié par cette revue non plus.

---

## 1. Objectif et périmètre

**Objectif** : déterminer comment ATLAS peut formaliser une proposition
commerciale (« Candidate Proposal ») à partir d'une `CandidateFinalDecision`
(décision finale du Client sur un candidat), suivre son acceptation/refus/
expiration/retrait, et préparer — sans l'implémenter — la transition vers la
création d'une `Mission`.

**Périmètre** : exclusivement architectural. Aucune ligne de code, aucun
champ Prisma, aucun endpoint n'est créé. Le livrable est ce document.

**Hors périmètre explicite** (repris en détail en §16) : schéma Prisma
définitif, migration, API, UI, tests, modification de `Mission`, du moteur
financier, du Capability Engine, de l'Agentic Runtime, du Learning Loop.

---

## 2. État de l'architecture existante

Vérifié directement dans le code et les contrats acceptés, jamais supposé.

### 2.1 La chaîne déjà verrouillée par la CTO Validation du lot précédent

**[CONTRAINTE EXISTANTE]** — `CANDIDATE_DECISION_INTERVIEW_CTO_VALIDATION.md`
§18 ("Future Compatibility") verrouille déjà explicitement la chaîne
complète :

```
RoleProfile → ClientNeed → DemandeTalent → ShortlistEntree →
CandidateSelection → Interview → InterviewEvaluation → Comparison →
CandidateFinalDecision → [futur] Proposal → Mission → MissionAssignment →
Outcome → FinancialResult
```

Ce document traite exclusivement le maillon **`CandidateFinalDecision` →
`Proposal`** et la préparation (jamais l'implémentation) du maillon
**`Proposal` → `Mission`**.

### 2.2 `CandidateFinalDecision` / `CandidateFinalDecisionEntree` (réellement implémenté, `prisma/schema.prisma:233-260`)

```prisma
model CandidateFinalDecision {
  id                             String @id @default(cuid())
  demandeTalentId                String
  decideParEmail                 String
  communiqueParClientHorsSysteme Boolean @default(false)
  canalHorsSysteme               String?
  supersedesId                   String? @unique   // append-only, jamais réécrit
  createdAt                      DateTime @default(now())
  entrees                        CandidateFinalDecisionEntree[]
}

model CandidateFinalDecisionEntree {
  id                   String @id @default(cuid())
  decisionId           String
  candidateSelectionId String
  statut               CandidateFinalDecisionStatutEntree // RETENU | NON_RETENU
  justification        String?
  @@unique([decisionId, candidateSelectionId])
}
```

Faits vérifiés (`CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md:263-277`) :
- **Ownership** : `decideParEmail` doit être un email CLIENT, sauf
  `communiqueParClientHorsSysteme: true` + `canalHorsSysteme` renseigné (Admin
  enregistrant pour le compte du Client — jamais une décision Admin
  autonome). Validé en service, jamais en DB.
- **Immutabilité** : totale, append-only via `supersedesId`.
- **Invariant transactionnel déjà en place** : au plus une
  `CandidateFinalDecision` active (non-supersédée) par `demandeTalentId`,
  vérifié par transaction (même pattern Serializable+retry que §10 ci-dessous).
- **Relation avec Proposal/Mission** : **aucune aujourd'hui**. Ce modèle ne
  crée jamais de `Mission` ni de `Proposal` — confirmé verrouillé.
- **Compatibilité Proposal explicitement préparée, jamais implémentée**
  (`IMPLEMENTATION_CONTRACT.md:455-459`) : *"`CandidateFinalDecision` expose
  `id`/`entrees[].candidateSelectionId`/`entrees[].statut` — champs suffisants
  pour qu'un futur `Proposal` référence cette décision par id, sans qu'aucun
  champ préparatoire ne soit ajouté ici (confirmé : aucune colonne
  `proposalId`/`missionDraftId` dans ce schéma)."*

### 2.3 `Mission` (réellement implémenté, `prisma/schema.prisma:1240-1389`)

Faits vérifiés par lecture directe :
- `profilId String` — **non nullable**, relation obligatoire vers `Profil`.
- `clientId String` — non nullable.
- `tjmVente Float`, `nbJours Int`, `margeCible Float` — **toujours saisis
  par l'Admin à la création**, jamais calculés ni hérités automatiquement.
- `needVersionId String?` / `solutionDecisionId String?` (A18) — additifs,
  nullables, **immuables une fois posés** (contrôlé au niveau service,
  `onDelete: SetNull` jamais `Cascade`). `solutionDecisionId` est un
  **pointeur texte simple** (pas une relation Prisma) vers une ligne
  `SolutionOption(niveau=DECISION)` — domaine **Solution**, pas Candidate.
- **Aucun champ `sourceCandidateProposalId`/`sourceCandidateFinalDecisionId`
  n'existe** — confirmé par lecture complète du modèle.
- **Création exclusivement par `POST /api/missions` (Admin-only,
  `app/api/missions/route.ts:138-277`)** : `clientId`, `profilId`, `nbJours`,
  `tjmVente` sont **toujours requis explicitement dans le body**. Quand
  `sourceDemandeId` est fourni, seul `clientId` est dérivé serveur (jamais le
  prix, jamais le profil) — pattern LOT 6 de **pré-remplissage de contexte**,
  jamais de **création automatique**. Aucun code du dépôt ne crée une
  `Mission` automatiquement à partir d'un changement de statut ailleurs.
- `validerPinsMission()` (`lib/mission/need-pinning.ts`) : toute
  incohérence (Need introuvable, mauvais niveau, décision non finalisée,
  tenant différent) est un refus explicite — **jamais une correction
  silencieuse**.

### 2.4 Le domaine « Solution » — précédent de décision commerciale déjà existant, distinct

**[CONTRAINTE EXISTANTE]** — `SolutionOption(niveau=DECISION)` via
`deciderSolution()` (`lib/client-solution/decision.ts`) est le **seul**
précédent réel de « décision commerciale » dans le dépôt avant ce lot :
- Append-only strict : chaque décision est une **nouvelle ligne**, jamais un
  UPDATE. Pas de machine à états : la ligne DECISION est créée **au moment
  même** de la décision — il n'existe aucune notion d'un objet « en attente
  de réponse » dans ce domaine (contrairement à ce qu'un `Proposal` doit
  représenter).
- Fraîcheur vérifiée à la décision (`RECOMMANDATION_OBSOLETE` si la
  recommandation n'est plus la plus récente, si sa signature de source a
  changé, ou si le Need a forké depuis) — **aucune correction automatique**,
  toujours un refus explicite.
- `SolutionOption.clientId` est **dénormalisé** depuis `need.clientId` pour
  une vérification d'ownership en une seule lecture — précédent direct pour
  le même choix de dénormalisation proposé en §5 pour `Proposal`.
- `Mission.solutionDecisionId` référence cette chaîne — **domaine
  entièrement distinct** de la chaîne Candidate/Talent traitée par ce
  contrat (`COMMERCIAL_FOUNDATION_DESIGN_CONTRACT.md` ADR confirmés :
  "Staffing" réutilise `DemandeTalent`, "Commercial Opportunity" reste
  `ClientNeed`, aucun des deux domaines n'est fusionné).

**Conséquence architecturale** : le cycle de vie d'un `Proposal` candidat ne
peut **pas** être calqué sur `SolutionOption(DECISION)` (qui n'a pas de
notion d'« attente de réponse ») — il doit être calqué sur une vraie machine
à états, plus proche d'`Interview.statut` ou de `CandidateFinalDecision` que
de `deciderSolution()`. Voir §7.

### 2.5 `COMMERCIAL_FOUNDATION_DESIGN_CONTRACT.md` — frontière déjà actée

**[CONTRAINTE EXISTANTE]** (§14 de ce contrat, déjà accepté avant ce lot) :
*"La Proposition commerciale (`Proposal`) est un futur lot [...] Elle devra
être distincte de : `ClientNeed`, `SolutionOption`, `DemandeTalent`,
`Mission`, `MissionAssignment`, `FinancialResult`. Aucune table `Proposal`
n'est créée par ce contrat."* Ce document hérite et respecte cette frontière
sans la rouvrir.

### 2.6 Invariants A18/A19 cités par le mandat

**[CONSTAT FACTUEL]** — vérification directe : seul **A18** ("Mission Need
Pinning + Solution Decision") existe comme lot nommé et documenté dans le
dépôt (`prisma/schema.prisma:1300`, `lib/mission/need-pinning.ts`,
`tests/api/a18-mission-need-pinning.spec.ts`). **Aucun lot « A19 » distinct
n'existe** — la seule occurrence du terme dans le dépôt est une mention
groupée ("invariants A18/A19 cités par le mandat") dans
`CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_AUDIT.md:770`, sans définition
propre. Le lot suivant réellement documenté après A18 est **A20**
(`MissionAssignment` Foundation). Ce contrat traite donc les invariants A18
réels (pinning immuable, jamais de correction silencieuse, `SetNull` jamais
`Cascade`) comme la seule base vérifiable ; aucune règle n'est inventée pour
combler une « A19 » qui n'a pas de définition traçable.

### 2.7 Audit métier (`journaliser()`) et conventions RBAC/tenant

**[CONTRAINTE EXISTANTE]** — `lib/audit.ts::journaliser()` : écrit une ligne
`JournalActivite` (`acteurEmail`, `acteurRole`, `action`, `cible?`,
`detail?`, `correlationId?`), **best-effort** (un échec d'écriture ne doit
jamais faire échouer l'action). `CANDIDATE_DECISION_INTERVIEW_CTO_VALIDATION.md`
§16 verrouille en outre : une action unique par type de transition
métier **quel que soit le canal** (Client via UI ou Admin pour son compte) —
le canal est capturé par un champ (`communiqueParClientHorsSysteme`), jamais
par une action d'audit distincte.

Convention RBAC/tenant déjà universelle dans le dépôt, reconduite sans
modification : 403 = rôle interdit, 404 = ressource d'un autre tenant ou
inexistante (jamais distingués), AGENT n'a jamais d'accès direct à une
mutation commerciale (`COMMERCIAL_FOUNDATION_DESIGN_CONTRACT.md` §9,
`CANDIDATE_DECISION_INTERVIEW_CTO_VALIDATION.md` §15).

---

## 3. Flux métier cible

Le flux proposé par le mandat est confirmé **cohérent avec la chaîne déjà
verrouillée** (§2.1) :

```
DemandeTalent → Sélection anonymisée → Entretiens/Évaluations →
CandidateFinalDecision (RETENU) → CandidateProposal →
ACCEPTEE | REFUSEE | EXPIREE | RETIREE →
[préparation, jamais création automatique] → Mission
```

**[CONTRAINTE EXISTANTE]** — ce flux concerne **exclusivement** la chaîne
Candidate/Talent (`DemandeTalent`). Il ne touche ni ne remplace la chaîne
Solution (`ClientNeed` → `SolutionOption(DECISION)`), qui reste un domaine
parallèle et distinct (§2.4). Les deux chaînes peuvent toutes deux aboutir à
une `Mission`, par des chemins différents (`Mission.solutionDecisionId` pour
l'une, un futur champ équivalent pour l'autre — voir §11).

**[RECOMMANDATION]** — seule une `CandidateFinalDecisionEntree` avec
`statut = RETENU` peut donner naissance à un `CandidateProposal`. Une entrée
`NON_RETENU` n'a par construction aucun besoin commercial : aucune
proposition ne doit jamais lui être associée.

---

## 4. Responsabilités et frontières de domaine

**[CONTRAINTE EXISTANTE / RECOMMANDATION appliquée]** — conformément au
mandat §6.2, les responsabilités suivantes restent strictement séparées,
jamais fusionnées dans un modèle générique :

| Responsabilité | Objet porteur | Statut |
|---|---|---|
| Décision sur le candidat (retenu/non retenu) | `CandidateFinalDecision`/`Entree` | Existant, inchangé |
| Proposition commerciale (termes, émission, réponse) | `CandidateProposal` (ce contrat) | Nouveau, conceptuel |
| Acceptation commerciale (côté ATLAS) | État `ACCEPTEE` de `CandidateProposal` | Nouveau, conceptuel |
| Création de Mission | `Mission` (`POST /api/missions`, Admin) | Existant, **inchangé** |
| Opérations financières/facturation | `FinancialResult`, `Facture` | Existant, **non touché** |

Aucun de ces cinq axes n'est un simple sous-état d'un autre. En particulier
(§14 anti-dérive) : **l'acceptation commerciale dans ATLAS n'est jamais, par
elle-même, la création d'une Mission** — ce sont deux faits distincts reliés
par une transition explicite et toujours humaine (Admin), jamais une cascade
automatique.

---

## 5. Objets métier candidats et relations conceptuelles

### 5.1 Objet proposé : `CandidateProposal`

**[RECOMMANDATION]** — un objet léger, par **candidat retenu individuel**,
jamais un objet « batch » couvrant plusieurs candidats.

**Justification du choix "un candidat par proposition"** :
- `Mission.profilId` est singulier (une Mission = un candidat) — un objet
  `Proposal` multi-candidats introduirait une relation 1-à-N vers la future
  création de Mission qu'aucun objet existant ne modélise, et romprait la
  granularité déjà posée par `Mission`.
- Deux candidats RETENU sur une même `DemandeTalent` (ex. le Client souhaite
  engager deux profils du même besoin) ont des termes commerciaux
  potentiellement différents (TJM, date de début, durée) — un objet unique
  forcerait soit une duplication de champs par candidat à l'intérieur d'un
  même `Proposal` (retombe sur le problème qu'évite déjà
  `CandidateFinalDecisionEntree` vs `CandidateFinalDecision`), soit des
  termes partagés artificiellement.
- Le précédent `CandidateFinalDecision`/`CandidateFinalDecisionEntree`
  lui-même sépare déjà "l'enveloppe de décision" (plusieurs candidats) de
  "la ligne par candidat" (un statut par candidat) — **réutiliser la même
  séparation** est cohérent, pas une nouvelle convention.

**Parent conceptuel : `CandidateFinalDecisionEntree`**, pas
`CandidateFinalDecision`. Une `CandidateProposal` référence
**exactement une** `CandidateFinalDecisionEntree` (celle avec
`statut = RETENU`), jamais l'enveloppe `CandidateFinalDecision` entière.
Ceci est cohérent avec la note de compatibilité déjà écrite dans
l'Implementation Contract (§2.2) qui cite précisément
`entrees[].candidateSelectionId`/`entrees[].statut` comme les champs
pertinents pour un futur `Proposal`.

**Scoping tenant** : `clientId` et `demandeTalentId` **dénormalisés** sur
`CandidateProposal` (même précédent que `SolutionOption.clientId`,
§2.4) — permet une vérification d'ownership en une seule lecture, sans
remonter la chaîne `Entree → CandidateFinalDecision → DemandeTalent →
Client` à chaque requête Client.

### 5.2 Relations conceptuelles (schéma non implémenté)

```
DemandeTalent (existant)
    └── CandidateFinalDecision (existant, append-only)
            └── CandidateFinalDecisionEntree (existant, statut RETENU/NON_RETENU)
                    └── CandidateProposal (NOUVEAU, conceptuel) [0..N dans le temps, 1 active]
                            ├── supersedesId → CandidateProposal (append-only, même pattern)
                            └── [hors scope implémentation] → Mission (future, via préparation §11)
```

### 5.3 Plusieurs propositions successives après refus/expiration

**[RECOMMANDATION]** — oui, via le même mécanisme `supersedesId` déjà
utilisé par `ShortlistEntree`, `CandidateFinalDecision` et
`InterviewEvaluation` (append-only, jamais de réécriture). Une nouvelle
`CandidateProposal` (nouveaux termes) peut être émise après `REFUSEE`,
`EXPIREE` ou `RETIREE` de la précédente, en la référençant par
`supersedesId`. **Jamais après `ACCEPTEE`** — voir §7.4.

**[RECOMMANDATION — pas de choix d'une nouvelle structure]** — ce mécanisme
est délibérément **le même** que celui déjà employé trois fois dans le
dépôt, conformément au mandat §6.4 ("ne choisis pas automatiquement une
nouvelle structure si un mécanisme existant peut répondre au besoin").
Aucune alternative (ex. table d'historique séparée, versioning numéroté) n'a
été identifiée comme nécessaire.

---

## 6. Contenu et stratégie de snapshot

**[CONTRAINTE DU MANDAT]** — aucun tarif, taux, montant ou condition
commerciale n'est fixé par ce document. Les champs ci-dessous sont des
**emplacements**, pas des valeurs.

### 6.1 Ce qui doit être référencé (jamais copié)

| Donnée | Mécanisme |
|---|---|
| Identité du candidat | `candidateFinalDecisionEntreeId` → remonte à `candidateSelectionId` → `shortlistEntree.profilId` (jamais copié : `Profil` continue d'évoluer, p.ex. disponibilité, sans que cela doive réécrire la proposition) |
| Contexte de la demande | `demandeTalentId` (dénormalisé pour le tenant, §5.1) — jamais une copie des critères de `DemandeTalent` |
| Client | `clientId` (dénormalisé) |

### 6.2 Ce qui doit être figé (snapshot), avec justification explicite

**[RECOMMANDATION — emplacements de champs, aucune valeur]** :

| Champ figé | Pourquoi un snapshot et pas une référence |
|---|---|
| Conditions commerciales proposées (ex. TJM proposé, devise, durée/date de début envisagée — **valeurs à définir par l'Admin à l'émission, aucune valeur par défaut, aucune formule introduite ici**) | Si ces valeurs étaient lues dynamiquement depuis une autre table au moment de l'acceptation, une modification ultérieure (ex. grille tarifaire changée) changerait rétroactivement ce que le Client a accepté — **exactement le risque métier n°7 du mandat §8**. L'historique commercial doit rester consultable tel qu'il a été proposé et accepté, pas tel qu'il serait recalculé aujourd'hui. |
| Horodatage d'émission + date de validité | Nécessaire pour calculer `EXPIREE` sans scheduler (§7.3) — doit être figé au moment de l'émission, jamais recalculé. |
| Référence candidate figée (id du `Profil` au moment de l'émission, pas son état courant) | Le `profilId` lui-même (identifiant) est référencé, pas copié — mais la **décision de proposer ce candidat précis** doit être traçable même si le `Profil` est désactivé/modifié après coup. |

### 6.3 Ce qui ne doit jamais être copié

**[CONTRAINTE DU MANDAT]** — `CandidateProposal` ne doit **jamais** devenir
une copie mutable des données de `DemandeTalent`, `Profil`, `ClientNeed` ou
`Mission`. Aucun champ de compétences, de critères de matching, de score, de
disponibilité courante n'est dupliqué — ces données restent exclusivement
dans leurs tables sources, lues par référence si besoin d'affichage (jamais
stockées).

---

## 7. Cycle de vie et transitions

### 7.1 Pourquoi ce cycle de vie diffère du seul précédent commercial existant

Comme établi en §2.4, `SolutionOption(DECISION)` n'a **aucune notion
d'attente de réponse** — elle est créée au moment même de la décision. Un
`Proposal` est, par nature, **envoyé puis attendu** : il a besoin d'une vraie
machine à états, plus proche du cycle de vie d'`Interview.statut` (PLANIFIE
→ CONFIRME/ANNULE) que de `deciderSolution()`.

### 7.2 États retenus et justification individuelle

**[RECOMMANDATION]** — **5 états persistés**, pas 7 (écart justifié
ci-dessous par rapport à la liste illustrative du mandat) :

| État | Justifié par |
|---|---|
| `BROUILLON` | L'Admin doit pouvoir assembler les termes commerciaux (TJM, durée, dates) avant toute visibilité Client — sans engager quoi que ce soit. Mutable **uniquement** dans cet état. |
| `EMISE` | Le snapshot (§6.2) est figé et la proposition devient visible/actionnable par le Client. Aucune mutation des conditions commerciales n'est plus possible après ce point — toute correction passe par une nouvelle version (`supersedesId`), jamais une réécriture. |
| `ACCEPTEE` | Action explicite du Client (ou Admin pour son compte, §8) — déclenche l'éligibilité à la préparation Mission (§11), jamais la création automatique. |
| `REFUSEE` | Action explicite du Client — terminal pour cette ligne ; seule une nouvelle `CandidateProposal` (nouveaux termes) peut suivre, via `supersedesId`. |
| `RETIREE` | Fermeture administrative explicite d'une proposition encore `EMISE` (ou même `BROUILLON`) — nécessaire car l'absence quasi générale de hard-delete dans ATLAS (référentiels, `ShortlistEntree`, etc.) interdit de simplement supprimer une ligne envoyée par erreur ou devenue sans objet (ex. candidat devenu indisponible). Distinct de `REFUSEE` : initié côté ATLAS, pas une réponse du Client. |

**[RECOMMANDATION — écart justifié par rapport à la liste illustrative du
mandat]** — **`EXPIREE` et `REMPLACEE` ne sont PAS des valeurs d'enum
persistées** :

- **`EXPIREE` est dérivée, jamais stockée.** Précédent direct déjà dans le
  dépôt : `lib/url-signee.ts` (`creerUrlSignee`/`verifierUrlSignee`) encode
  une expiration vérifiée **au moment de l'usage**, sans jamais écrire un
  état "EXPIRÉ" en base, sans scheduler. Appliqué ici : une fonction pure
  `calculerStatutEffectif(proposal, maintenant)` retourne `EXPIREE` si
  `statut stocké == EMISE` **et** `maintenant > dateValidite`, sans jamais
  modifier la ligne. Toute tentative d'accepter/refuser une proposition dont
  le statut stocké est encore `EMISE` mais dont la date de validité est
  dépassée est refusée au niveau service (même discipline que
  `ReponseSurInterviewTermineeError` dans le domaine Interview). **Aucun
  scheduler, aucun job cron, aucune écriture différée n'est introduit** —
  conforme à l'interdiction explicite du mandat §7.
- **`REMPLACEE` est dérivée, jamais stockée.** Précédent direct :
  `CandidateFinalDecision`/`ShortlistEntree`/`InterviewEvaluation` n'ont
  **aucun** champ `statut = REMPLACEE` — la supersession est **uniquement**
  portée par `supersedesId`/`supersededBy` (relation), jamais par une
  réécriture du statut de l'ancienne ligne. Appliquer un `statut` littéral
  `REMPLACEE` introduirait une double source de vérité (le champ `statut`
  pourrait diverger de la relation réelle) — risque explicitement cité par
  le mandat (§8, risque n°7, altération rétroactive). "Est-ce remplacé ?"
  se lit par `supersededBy != null`, jamais par un enum.

### 7.3 Table des transitions autorisées

| Depuis | Vers | Acteur | Garde |
|---|---|---|---|
| `BROUILLON` | `EMISE` | ADMIN | Snapshot commercial complet requis (aucun champ obligatoire vide) |
| `BROUILLON` | `RETIREE` | ADMIN | Toujours autorisé |
| `EMISE` | `ACCEPTEE` | CLIENT (ou ADMIN pour son compte, §8) | `maintenant <= dateValidite` (sinon refus explicite, jamais un flip silencieux vers EXPIREE) |
| `EMISE` | `REFUSEE` | CLIENT (ou ADMIN pour son compte) | idem |
| `EMISE` | `RETIREE` | ADMIN | Toujours autorisé avant toute réponse Client |
| `ACCEPTEE` | *(aucune)* | — | **Terminal** — voir §7.4 |
| `REFUSEE` | *(aucune directe — seulement une nouvelle `CandidateProposal` via `supersedesId`)* | ADMIN | — |
| `RETIREE` | *(idem)* | ADMIN | — |

Toute tentative de transition hors de cette table est un refus explicite
(409/400 selon convention existante), **jamais une correction silencieuse**.

### 7.4 Pourquoi `ACCEPTEE` est strictement terminal

**[LOCKED — A35, D1]** — une fois `ACCEPTEE`, la ligne n'est **plus jamais
modifiable en place** et aucune supersession silencieuse n'est autorisée :
si les termes doivent changer après acceptation (négociation
post-acceptation), c'est soit une **nouvelle proposition** (nouvelle ligne,
jamais une réécriture — mais voir la restriction ci-dessous), soit une
**procédure distincte**, explicitement hors scope de ce lot (non définie
ici, voir §16). L'historique de l'acceptation initiale (`decideParEmail`,
horodatage, snapshot figé) reste **immuable et consultable indéfiniment**,
même si une correction ultérieure intervient par un autre mécanisme.

**Justification** : autoriser une réécriture ou une supersession de
`ACCEPTEE` ouvrirait exactement les risques n°3/n°7 du mandat (double
acceptation, altération rétroactive d'une proposition déjà acceptée). Le
même choix a déjà été fait pour l'état terminal analogue le plus proche du
dépôt (`Interview.statut`, transitions `CONFIRME`/`ANNULE`, jamais
réversibles une fois atteintes) — pas une nouvelle convention.

**[LOCKED — A35, D1 : distinction terminalité de la proposition / réussite
de la création de Mission]** — la terminalité d'`ACCEPTEE` porte
**exclusivement** sur l'état de la `CandidateProposal` elle-même, jamais sur
le succès de la création de `Mission` qui en découle (§11, étape
structurellement distincte et toujours postérieure). Si la création de
`Mission` échoue après l'acceptation (erreur de saisie Admin, conflit de
concurrence au niveau `Mission`, panne transitoire), **la proposition reste
`ACCEPTEE`** — elle n'est jamais ramenée à `EMISE` ou tout autre état
antérieur pour "permettre une nouvelle tentative". La preuve de
l'acceptation initiale ne doit jamais disparaître à cause d'un échec
opérationnel situé dans un domaine distinct (`Mission`).

**Mécanisme de reprise attendu** : la reprise après un échec de création de
`Mission` se fait en **réessayant la création de `Mission` elle-même**
(`POST /api/missions`, acte Admin, déjà idempotent par construction via le
mécanisme anti-doublon de §11.2) — **jamais** en rejouant ou en modifiant la
transition d'acceptation de la `CandidateProposal`. Une `CandidateProposal`
`ACCEPTEE` sans `Mission` créée est un état **stable et valide**, pas une
anomalie à corriger côté `Proposal` (cohérent avec le risque n°9 du mandat,
déjà traité en §13).

---

## 8. RBAC et tenant isolation

### 8.1 Droits proposés

**[RECOMMANDATION]**, directement dérivée de la règle déjà verrouillée
(CTO Validation §13) pour `CandidateFinalDecision` :

| Rôle | Droits |
|---|---|
| ADMIN | Créer/éditer un `BROUILLON`, émettre (`EMISE`), retirer (`RETIREE`), **enregistrer** une réponse Client communiquée hors système (jamais décider à sa place) |
| CLIENT | Lire ses propres propositions `EMISE`/`ACCEPTEE`/`REFUSEE` (jamais `BROUILLON` d'un autre, jamais `BROUILLON` tout court avant émission) ; **accepter/refuser explicitement** |
| INGENIEUR | Aucun accès — un candidat n'a jamais de visibilité sur une proposition commerciale le concernant (même posture que son absence totale de pouvoir commercial ailleurs dans ATLAS) |
| AGENT | **Aucun accès direct**, ni création ni acceptation — **[CONTRAINTE EXISTANTE]** reconduite telle quelle (mandat §6.5, déjà la règle universelle du dépôt) |

### 8.2 Acceptation pour compte du Client (hors système)

**[RECOMMANDATION — réutilisation exacte d'un mécanisme déjà verrouillé]** —
mirroring strict de `CandidateFinalDecision` (CTO Validation §13) : l'Admin
peut enregistrer une réponse (`ACCEPTEE`/`REFUSEE`) communiquée par le
Client via un canal hors-système, **uniquement** avec
`communiqueParClientHorsSysteme: Boolean` + `canalHorsSysteme: String?`
renseignés — jamais comme un jugement Admin propre. Reprend les **mêmes noms
de champs** que `CandidateFinalDecision`, pour cohérence lexicale dans tout
le domaine Candidate.

### 8.3 Tenant isolation

**[CONTRAINTE EXISTANTE reconduite]** :
- Toute route Client scope par `clientId` dérivé de la session, jamais du
  body.
- 404 pour une ressource d'un autre tenant ou inexistante — **jamais
  distingués**, pour ne jamais révéler l'existence d'une proposition d'un
  autre Client.
- Aucun `profilId`/`candidateSelectionId` candidat n'est accepté comme
  entrée suffisante côté Client — toujours revalidé contre son propre
  `demandeTalentId`/`clientId` (même discipline IDOR que tout le domaine
  Candidate Decision + Interview).

---

## 9. Audit et traçabilité

**[RECOMMANDATION]** — réutilisation stricte de `journaliser()`
(`lib/audit.ts`), **aucun nouveau système d'audit, aucun Control Plane
AuditEvent** pour ces opérations commerciales ordinaires (conforme au
mandat §6.6).

Actions proposées (vocabulaire cohérent avec `candidate.final_decision.recorded`
déjà existant) :
- `candidate.proposal.emitted`
- `candidate.proposal.accepted`
- `candidate.proposal.rejected`
- `candidate.proposal.withdrawn`

**[RECOMMANDATION — reprise de la règle CTO Validation §16]** — une seule
action par transition, **quel que soit le canal** (Client UI ou Admin pour
son compte) ; le canal est capturé par `communiqueParClientHorsSysteme`,
jamais par une action d'audit distincte. Aucune action d'audit n'est
nécessaire pour la transition dérivée `EXPIREE` (§7.2) puisqu'elle ne
correspond à **aucune écriture** — rien à journaliser pour un état qui
n'existe qu'au moment de la lecture.

---

## 10. Idempotence et concurrence

### 10.1 Pattern réutilisé

**[RECOMMANDATION]** — réutilisation exacte du pattern déjà établi et
audité dans ce même domaine (`lib/interview/service.ts`,
`enregistrerReponseInvitationAvecRetry`) : transaction
`Prisma.TransactionIsolationLevel.Serializable` + retry sur `P2034`
(`MAX_TENTATIVES = 3`), pour toute transition qui lit un état multi-lignes
avant de décider (ex. "au plus une `CandidateProposal` active par
`CandidateFinalDecisionEntree`").

### 10.2 Double acceptation concurrente (risque n°3 du mandat)

**[RECOMMANDATION]** — transition `EMISE → ACCEPTEE` via un **UPDATE
conditionnel atomique** (`WHERE id = ... AND statut = 'EMISE'`), même
principe que celui déjà documenté dans
`lib/interview/reminders.ts` ("la revendication d'une ligne se fait par un
UPDATE conditionnel atomique — une seule invocation concurrente peut
'gagner' une ligne donnée"). Deux acceptations simultanées : une seule
affecte une ligne, l'autre affecte 0 ligne et reçoit explicitement l'état
déjà atteint — **idempotent sur le résultat final**, jamais une double
exécution des effets de bord (audit, email).

### 10.3 Plusieurs propositions actives incompatibles (risque n°4)

**[RECOMMANDATION]** — invariant "au plus une `CandidateProposal` active
(`BROUILLON`/`EMISE`/`ACCEPTEE`) par `CandidateFinalDecisionEntree`",
vérifié en transaction Serializable+retry à la création/émission — **même
formulation exacte** que l'invariant déjà en place pour
`CandidateFinalDecision` ("au plus une active par `demandeTalentId`").

### 10.4 Double création de Mission après acceptation (risque n°5)

Traité en détail en §11.2.

### 10.5 Validité de la décision source au moment de l'acceptation (A35, D4)

**[CONSTAT FACTUEL VÉRIFIÉ — A35]** — relecture complète de
`lib/candidate-decision/final-decision.ts` : un mécanisme de supersession
**fiable et déjà audité** existe pour `CandidateFinalDecision` —
`lireCandidateFinalDecisionActive()` lit `findFirst({ where: {
demandeTalentId, supersededBy: null } })`, c'est-à-dire la ligne dont
**aucune autre** ne porte `supersedesId` vers elle. La création elle-même
(`creerCandidateFinalDecision`, dans `creerCandidateFinalDecisionAvecRetry`)
relit cet état **dans la même transaction Serializable** avant de décider,
et refuse explicitement (`DecisionActiveExistanteError`) toute création qui
ne référence pas la décision active réelle. **Ce mécanisme répond
directement à l'inquiétude du mandat** ("si les décisions existantes ne
possèdent pas de mécanisme de supersession fiable, documente cette
limite") — la limite ne s'applique pas : le mécanisme existe et est
réutilisable tel quel.

**[LOCKED — A35, D4]** — la transition `EMISE → ACCEPTEE` (ou `REFUSEE`)
doit, **dans la même transaction Serializable+retry** que celle qui
effectue l'UPDATE conditionnel (§10.2), relire si la
`CandidateFinalDecisionEntree` source appartient toujours à la
`CandidateFinalDecision` **active** (`supersededBy: null`, même requête que
`lireCandidateFinalDecisionActive()`). Si la décision source a été
supersédée entre l'émission de la proposition et la tentative
d'acceptation : **refus explicite**, jamais un succès supposé, jamais une
correction silencieuse vers la nouvelle décision active. Un conflit de
sérialisation (`P2034`) pendant cette relecture déclenche le retry standard
(relit un état frais), **jamais** une résolution optimiste.

**[LOCKED — A35.1, D4 : comportement après refus — quatre règles]** —
arbitrage final, vérifié compatible avec le mécanisme réel de supersession
(`supersedesId`/`supersededBy`, §10.5 ci-dessus, et §5.3) :

1. **Pas de réactivation automatique** : une `CandidateProposal`
   `REFUSEE` (ou `EXPIREE`/`RETIREE`) ne repasse **jamais** à `EMISE` ou
   `ACCEPTEE`, quel que soit l'événement déclencheur — cohérent avec la
   terminalité déjà verrouillée de ces états (§7.3) et avec l'absence de
   toute transition inverse dans la table des transitions autorisées.
2. **Pas de changement rétroactif de décision source** : la
   `CandidateFinalDecisionEntree` référencée par une proposition déjà
   `REFUSEE` n'est **jamais** réécrite pour pointer vers une nouvelle
   décision active — le snapshot et la référence d'une proposition
   terminée restent figés (même discipline que §6.2/§6.3).
3. **Toute nouvelle proposition (successeur, via `supersedesId`) doit être
   liée à une décision active et autorisée** : la création d'une nouvelle
   `CandidateProposal` référencée comme successeur d'une `REFUSEE`/
   `EXPIREE`/`RETIREE` doit, **dans la même transaction Serializable+retry**
   que sa création, vérifier que la `CandidateFinalDecisionEntree` cible
   appartient à la `CandidateFinalDecision` **active**
   (`supersededBy: null`, même requête que `lireCandidateFinalDecisionActive()`)
   et porte toujours `statut = RETENU` — même discipline de fraîcheur
   qu'à l'acceptation (ci-dessus), appliquée cette fois à la **création**.
4. **Si aucune décision active valide n'existe** (le candidat n'est plus
   `RETENU` dans la décision active, ou aucune décision active n'existe
   pour cette `DemandeTalent`) : la création de la nouvelle proposition est
   **refusée explicitement** — jamais une création silencieuse sur une
   base obsolète, jamais une tentative de "retrouver" une décision
   plausible par une autre voie.

Ces quatre règles sont compatibles sans modification avec le mécanisme
réel : `creerCandidateFinalDecisionAvecRetry` applique déjà exactement la
même discipline (refus explicite via `DecisionActiveExistanteError`/
`SupersedesIntrouvableError` si la décision référencée n'est pas la
décision active) — ce contrat **réutilise** ce précédent, n'invente rien.

---

## 11. Transition vers Mission

**[CONTRAINTE DU MANDAT]** — contrat de transition uniquement, **aucune
implémentation**. `Mission.profilId` reste non-nullable, aucun champ
existant de `Mission` n'est modifié par ce document.

### 11.1 Ce que `ACCEPTEE` déclenche réellement

**[RECOMMANDATION]** — `ACCEPTEE` rend la proposition **éligible** à devenir
le contexte de pré-remplissage d'une création de `Mission` — exactement le
même rôle que `sourceDemandeId` aujourd'hui (`app/api/missions/route.ts:158-179`) :
dérive `clientId`/suggère `dateDebut`/`modeTravail`, **jamais ne crée la
Mission elle-même**. La création reste un acte Admin explicite
(`POST /api/missions`), avec `profilId`/`nbJours`/`tjmVente` toujours
saisis/confirmés par l'Admin — jamais hérités automatiquement et
aveuglément du snapshot de la proposition (l'Admin peut et doit pouvoir
ajuster avant de committer, même règle que LOT 6).

**[QUESTION OUVERTE]** — le pré-remplissage doit-il copier le TJM proposé
comme valeur par défaut du formulaire de création de Mission, ou seulement
l'afficher en référence sans le pré-remplir ? Les deux sont compatibles
avec "aucune création automatique" ; le choix est un détail UX futur, pas
structurant pour ce contrat.

### 11.2 Empêcher une double création de Mission (risque n°5)

**[LOCKED — A35, D2 : exclusion explicite de la protection naïve]** — un
simple `findFirst()` suivi d'un `create()` séparé, même "dans une
transaction" nominale sans isolation renforcée, **n'est jamais une
protection valide** contre la concurrence : sous l'isolation par défaut
(READ COMMITTED), deux requêtes de création quasi simultanées peuvent
chacune lire "aucune Mission existante" avant que l'autre n'ait commité,
puis créer chacune sa propre `Mission` — exactement la même classe de "lost
update" déjà identifiée et corrigée dans le lot précédent pour la
transition CONFIRME (`lib/interview/service.ts`). Ce document exclut donc
explicitement toute implémentation future qui se contenterait de ce
pattern.

**[LOCKED — A35, D2 : stratégie retenue]** — deux mécanismes complémentaires,
jamais l'un à la place de l'autre lorsque le second devient possible :

| Option | Description | Statut |
|---|---|---|
| A — Contrainte DB (préférée dès que le schéma le permet) | Futur champ additif nullable `Mission.sourceCandidateProposalId` avec `@@unique` (Postgres autorise plusieurs `NULL`, mais un seul non-NULL par valeur) — garantie posée par la base elle-même, insensible à toute isolation de transaction côté application | **LOCKED comme stratégie préférée** — cohérent avec la préférence déjà observée dans le dépôt pour les contraintes dures quand possible (`@@unique([needParentId])`, A5.2 ; `@@unique([decisionId, candidateSelectionId])`, `CandidateFinalDecisionEntree`) |
| B — Transaction Serializable + retry (mécanisme transitoire ou de repli) | Avant `POST /api/missions` avec un `candidateProposalId` fourni : relecture explicite de "existe-t-il déjà une Mission référençant cette proposition" **à l'intérieur** d'une transaction `Prisma.TransactionIsolationLevel.Serializable`, avec retry sur `P2034` — **même pattern exact** que `creerCandidateFinalDecisionAvecRetry`/`enregistrerReponseInvitationAvecRetry` déjà audités dans ce domaine | **LOCKED comme garantie minimale si l'option A n'est pas encore en place** — jamais une garantie "au mieux", toujours une garantie atomique et vérifiable |

**[LOCKED — A35.1, D2 : identité d'unicité métier]** — relecture complète
du modèle `Mission` (§2.3) : **aucun champ existant** ne peut servir
d'identité stable vers une proposition acceptée — `sourceDemandeId` est
délibérément **non unique** (indexé, pas `@@unique` ; une `DemandeTalent`
peut légitimement produire plusieurs `Mission`, confirmé par le
commentaire du schéma lui-même). Aucun champ inexistant n'est donc traité
comme déjà disponible. L'identité d'unicité métier retenue est **l'id de
la `CandidateProposal` elle-même**, dans son état `ACCEPTEE` — jamais une
entité d'« acceptation commerciale » séparée (qui n'existe pas dans ce
modèle, §4 : `ACCEPTEE` est un statut de `CandidateProposal`, pas une
ligne distincte), jamais un identifiant recalculé ou composite. Cette
identité est déjà stable par construction : `ACCEPTEE` est terminale et
immuable (D1, §7.4) — l'id ne change jamais après ce point.

**[LOCKED — A35.1, D2 : garantie en base à exiger, avec dépendance
explicite]** — la garantie **requise**, pas seulement préférée, est une
contrainte d'unicité en base sur la référence de provenance
(`Mission.sourceCandidateProposalId String? @unique`, Postgres autorisant
plusieurs `NULL` mais un seul non-`NULL` par valeur — même pattern que
`@@unique([needParentId])`, A5.2). **Cette option exige un nouveau champ
additif sur `Mission`, qui n'existe pas aujourd'hui** — dépendance
explicitement documentée ici, **aucun schéma n'est modifié par cette
revue**. Tant que ce champ n'existe pas, la transaction Serializable+retry
(§11.2 ci-dessus) est la garantie **transitoire obligatoire**, jamais une
garantie "au mieux" — les deux mécanismes ne sont jamais substituables
silencieusement l'un à l'autre : la contrainte DB doit être ajoutée dès
que le contrat d'implémentation touche au schéma de `Mission`.

**[LOCKED — A35.1, D2 : réponse si une Mission issue de la même proposition
existe déjà]** — à l'intérieur de la même transaction, avant de créer :
- Si la requête de création porte **exactement les mêmes paramètres**
  qu'une tentative précédente ayant déjà abouti pour cette
  `CandidateProposal` (même retry technique, §11.2 ci-dessus) : renvoyer
  l'état déjà créé (la `Mission` existante), **jamais une seconde ligne**
  — comportement idempotent.
- Si la requête porte des **paramètres différents** (ex. `nbJours`/
  `tjmVente` modifiés) alors qu'une `Mission` référence déjà cette
  proposition : **refus explicite** (409, convention existante) — la
  première `Mission` créée reste autoritaire, jamais réécrite, jamais
  doublée.

**[LOCKED — A35.1, D2 : le cas d'une Mission sans référence de provenance]**
— qu'il s'agisse d'une `Mission` créée avant l'existence du champ, ou
créée par le flux Admin ordinaire sans passer par une `CandidateProposal` :
**aucune association automatique ou heuristique** (même profil, même
client, proximité temporelle) ne doit jamais relier après coup une telle
`Mission` à une `CandidateProposal` — conformément à l'instruction du
mandat. Si un rattachement rétroactif est un jour nécessaire, ce doit être
une action humaine explicite et revue, documentée comme une correction de
donnée — jamais un job de rapprochement automatique. Même doctrine déjà
appliquée ailleurs dans ce dépôt pour les anomalies de classification
(`ClientNeedFait(ROLE)` non rattaché, §2.5 du Commercial Foundation
Contract : "ANOMALIE — À CURER", jamais une classification automatique).

**[LOCKED — A35, D2 : distinction retry technique / nouvelle intention
métier]** — un retry déclenché par `P2034` (conflit de sérialisation
Postgres) est un **artefact technique** de la même tentative de création,
jamais une nouvelle décision métier — il doit relire l'état et reconclure
sur les **mêmes paramètres d'entrée**, jamais réinterpréter une intention
différente. Une **seconde requête HTTP** distincte (ex. double-clic Admin)
est, elle, potentiellement une nouvelle intention — elle doit être traitée
par la contrainte d'unicité (A) ou la relecture atomique (B), jamais
confondue avec un retry interne.

### 11.3 A18 : quel champ de pinning pour une Mission issue de la chaîne Candidate ?

**[LOCKED — A35, D3 : ce qui est exclu]** — vérifié par relecture complète
de `lib/mission/need-pinning.ts::validerPinsMission()` : `solutionDecisionId`
résout toujours vers une ligne `SolutionOption(niveau=DECISION)` et en
vérifie le `niveau`/la finalisation (`decideParEmail`/`decideLe`) — l'utiliser
pour pointer vers une `CandidateProposal`/`CandidateFinalDecisionEntree`
produirait soit une `SolutionDecisionIntrouvableError` (id d'un autre
domaine), soit, si l'id coïncidait accidentellement avec une vraie ligne
`SolutionOption`, une association **sémantiquement fausse** (un Pin
Candidate pointant vers une décision Solution sans rapport). **Les deux cas
sont exclus par construction** — ce contrat ne doit jamais fabriquer cette
correspondance, conformément à l'instruction du mandat.

**[CONSTAT FACTUEL VÉRIFIÉ — A35]** — relecture de
`validerPinsMission()` confirme que `needVersionId` et `solutionDecisionId`
sont **structurellement indépendants** dans le code réel : la fonction
accepte `needVersionId` seul (sans `solutionDecisionId`) sans aucune
condition croisée dans ce cas (la vérification de cohérence croisée ne
s'applique **que** si les deux sont fournis). `DemandeTalent.sourceNeedId`
est bien un champ réel, nullable, `@unique`
(`prisma/schema.prisma:1554`). Ce constat ne tranche **pas** l'option 2
ci-dessous — il confirme seulement qu'elle est **techniquement
exécutable aujourd'hui sans aucune modification de schéma ni de
`validerPinsMission()`**, ce qui change le coût d'implémentation de
l'option mais pas son bien-fondé métier.

**[LOCKED — A35.1, D3 : arbitrage pour la première implémentation]** — pour
la portée minimale (§11.5), **aucune référence n'est obligatoire** et
**aucune n'est fournie par le contexte source** : toute `Mission` créée
depuis cette chaîne laisse `needVersionId` et `solutionDecisionId` à
`null` — **option 1 retenue pour ce lot**, et pour ce lot seulement. Ce
n'est **pas une précondition bloquante** : `null` est une valeur
structurellement valide et acceptée sans condition par
`validerPinsMission()` (vérifié §2.3/ci-dessus), déjà le comportement de
la quasi-totalité des `Mission` existantes — il n'y a donc aucune donnée
manquante à réclamer, aucune référence à fabriquer, et rien à bloquer.
L'arbitrage porte sur une **absence délibérée de référence**, jamais sur
une référence devinée ou reconstruite.

**[OPEN — A35.1, D3 : extension future, hors portée minimale]** — les
options 2 (peupler `needVersionId` seul via `DemandeTalent.sourceNeedId`,
techniquement possible sans modification de code, confirmé ci-dessus) et
3 (nouveau champ dédié) restent sur la table pour un **lot ultérieur
séparé**, chacune nécessitant sa propre justification métier (quelle
valeur de traçabilité le pinning apporte-t-il sur la chaîne Candidate ?) —
absente aujourd'hui du dépôt, donc non inventée ici, conformément à
l'instruction du mandat ("ne déduis pas automatiquement `needVersionId` ou
`solutionDecisionId` depuis une autre entité sans contrat explicite"). Si
un lot futur active l'option 2 pour une `DemandeTalent` donnée dont
`sourceNeedId` est absent : le pin reste simplement `null` pour **cette
instance précise** (jamais un blocage de la création de `Mission`, jamais
une valeur fabriquée) — `validerPinsMission()` tolère déjà nativement
cette absence.

### 11.4 Idempotence/traçabilité attendues de la future création

**[RECOMMANDATION]** — quelle que soit l'option retenue en §11.2, la
création de Mission depuis une proposition acceptée doit être : (a)
**traçable** (on doit pouvoir répondre "quelle Mission, le cas échéant,
découle de cette proposition" — même esprit que `sourceDemandeId` déjà
traçable vers `DemandeTalent`), (b) **idempotente** (une seconde tentative
de création depuis la même proposition acceptée échoue explicitement,
jamais une seconde `Mission` silencieuse), (c) **jamais automatique sur la
base d'un statut ambigu** — `ACCEPTEE` seul n'autorise jamais une création
en tâche de fond ; l'acte de création reste humain et explicite.

### 11.5 Portée minimale de la première implémentation (LOCKED — A35.1)

**[LOCKED — A35.1]** — périmètre minimal de la première implémentation,
chaque point directement adossé à un invariant déjà verrouillé par §7-§11 :

**Inclus** :
1. Création d'un `BROUILLON` (Admin) — §7.2, §8.1.
2. Émission (`EMISE`) avec snapshot commercial explicite, figé dès ce
   point — §6.2, §7.2.
3. Acceptation / refus / retrait selon les transitions verrouillées en
   §7.3, avec la vérification de fraîcheur de la décision source à
   l'acceptation (D4, §10.5) et la protection anti-double-soumission
   (Serializable+retry + UPDATE conditionnel, §10.2).
4. Historique et audit métier via `journaliser()` — §9, aucun nouveau
   système d'audit.
5. Expiration **déterministe** si une échéance (`dateValidite`) est
   définie — dérivée et vérifiée à l'usage, jamais stockée ni dépendante
   d'un scheduler (§7.2).
6. Protection transactionnelle contre la double acceptation — §10.2,
   obligatoire dès la première implémentation, pas une amélioration
   différée.
7. Préparation/création idempotente de `Mission` selon les préconditions
   validées en §11.1-§11.4 : garantie Serializable+retry **obligatoire
   dès ce lot** (§11.2) ; pins A18 laissés `null` par défaut, sans
   précondition bloquante (D3, §11.3) ; aucune donnée tarifaire ou
   contractuelle n'est inventée — les valeurs commerciales restent
   celles saisies par l'Admin au snapshot, jamais une formule.

**Exclu de cette première implémentation**, sauf preuve ultérieure qu'un
élément est strictement indispensable (aucune preuve de ce type n'existe
dans le dépôt à ce jour) :
- Signature électronique, fournisseur externe de contrat.
- Facturation et toute modification du moteur financier
  (`FinancialResult`, `Facture`, calcul de marge) — §12, §16.
- Notifications externes complexes — seuls les emails best-effort déjà
  conventionnels (`lib/email.ts`) sont dans le périmètre (§12) ; aucune
  intégration SMS/webhook/CRM externe.
- Automatisation par Agent — `AGENT` reste sans accès direct, confirmé
  §8.1 (CONTRAINTE EXISTANTE, non rouverte).
- Workflow générique de documents.
- Modification des lots `Mission`/`WorkItem`/`Delivery` — §16, aucun
  champ existant de `Mission` n'est modifié, `WorkItem`/`Deliverable`/
  `DeliveryEvidence`/`DeliveryQualityGate` restent hors dépendance.
- Nouveau système générique de versioning — `supersedesId`/`supersededBy`
  (mécanisme déjà existant, réutilisé tel quel) couvre le besoin, §5.3.

**La revue juridique du vocabulaire (D5) demeure requise avant mise en
production**, sans bloquer la rédaction du contrat d'implémentation ni le
périmètre ci-dessus — **EXTERNAL VALIDATION REQUIRED**, non bloquante,
conforme à §15/D5.

---

## 12. Notifications et intégrations

**[RECOMMANDATION]** — emails à l'émission (`EMISE`) et à la réponse
(`ACCEPTEE`/`REFUSEE`), selon le pattern déjà établi dans `lib/email.ts`
pour le domaine Interview (templates `envoyerEmailXxx`, **best-effort**, `void`
non-bloquant, jamais une source de vérité).

**[CONTRAINTE DU MANDAT]** — les notifications restent des effets de bord :
- Elles ne doivent **jamais** constituer la preuve de l'acceptation —
  seule la ligne persistée (`statut = ACCEPTEE` + `decideParEmail`/horodatage)
  fait foi, exactement comme pour `CandidateFinalDecision`.
- **Aucun fournisseur externe, aucun scheduler, aucune intégration de
  signature électronique** n'est introduit dans ce lot — confirmé non
  nécessaire : `EXPIREE` est dérivée (§7.2, pas de scheduler requis),
  l'acceptation reste un acte applicatif interne (pas une signature
  juridique, voir §13 risque n°8 et §15 D5).

**[LOCKED — A35, D5 : quatre concepts séparés, jamais fusionnés]** —
1. **Acceptation enregistrée dans ATLAS** — un fait technique : une ligne
   `statut = ACCEPTEE` + acteur + horodatage, persisté et immuable (§7.4).
2. **Accord commercial entre les parties** — un fait business, en dehors du
   système, qu'ATLAS **enregistre** sans le **constituer**.
3. **Signature d'un contrat juridiquement valable** — acte juridique
   externe, jamais modélisé ni simulé par ATLAS.
4. **Création opérationnelle de Mission** — fait opérationnel distinct,
   toujours postérieur et toujours humain (§11).

Ce document ne prétend à aucun moment que (1) suffit à prouver (2) ou (3).
Ce qui est conservé par (1) — identité de l'acteur ayant cliqué/enregistré,
horodatage exact, canal (`communiqueParClientHorsSysteme`) — est **une
preuve d'un événement applicatif**, jamais une preuve juridique de
consentement contractuel.

---

## 13. Risques et mitigations

| # | Risque (mandat §8) | Prévention proposée | Stratégie de test future |
|---|---|---|---|
| 1 | Proposition sans décision finale autorisée | Validation stricte à la création : la `CandidateFinalDecisionEntree` référencée doit exister, appartenir au bon tenant, et avoir `statut = RETENU` — refus explicite sinon (même discipline que `validerPinsMission`) | Test service : création refusée sur entrée NON_RETENU/inexistante/autre tenant |
| 2 | Décision finale remplacée après émission | **[LOCKED — A35, D4]** Snapshot figé à l'émission (§6.2) ; une supersession ultérieure de `CandidateFinalDecision` **ne mute jamais** une proposition déjà `EMISE` par simple effet de bord. Mais **l'acceptation elle-même doit revérifier la fraîcheur de la décision source, de façon atomique, au moment de la tentative** (voir §10.5) — une décision source supersédée ne peut jamais être acceptée au seul motif que la proposition a été émise avant la supersession. | Test service : proposition déjà EMISE reste lisible/affichable après supersession de la décision source (snapshot intact) ; tentative d'ACCEPTER après supersession → refus explicite (voir §10.5), jamais un succès silencieux |
| 3 | Proposition acceptée deux fois par concurrence | UPDATE conditionnel atomique + Serializable/retry (§10.2) | Test de concurrence réelle (`Promise.all`, deux contextes HTTP), assertion sur l'état persisté — même pattern que le test CONFIRME du lot précédent |
| 4 | Plusieurs propositions actives incompatibles | Invariant "au plus une active par Entree", transactionnel (§10.3) | Test de concurrence : deux créations simultanées depuis la même Entree → une seule active en base |
| 5 | Double création de Mission après acceptation | Contrainte DB ou vérification applicative (§11.2, décision CTO requise) | Test API : deuxième tentative de création depuis la même proposition acceptée → refus explicite, jamais une 2e Mission |
| 6 | Accès à une proposition d'un autre tenant | Scoping `clientId` dénormalisé + 404 uniforme (§8.3) | Test IDOR : Client A sur une proposition de Client B → 404, jamais 403 distinctif |
| 7 | Altération rétroactive des conditions commerciales | Snapshot figé à l'émission (§6.2), aucune lecture dynamique d'un référentiel tarifaire au moment de l'acceptation | Test d'immutabilité : modifier une donnée source après émission ne change jamais le snapshot déjà figé |
| 8 | Confusion acceptation commerciale / contrat juridiquement signé | **[LOCKED — A35, D5]** `ACCEPTEE` documenté explicitement comme un fait interne ATLAS, jamais un acte juridique — quatre concepts séparés par construction (§12). **[EXTERNAL VALIDATION REQUIRED — A35, D5]** : validation juridique externe avant mise en production de tout texte visible Client employant le mot "accepté"/"proposition" — non bloquante pour ce document (la frontière ATLAS/externe est déjà explicite), mais obligatoire avant go-live | Revue non-technique (juridique) avant go-live, hors périmètre des tests automatisés |
| 9 | Incohérence statut Proposal / état réel Mission | Traçabilité explicite proposée en §11.4 (back-reference), jamais une déduction implicite | Test d'intégration : état `ACCEPTEE` sans Mission créée doit rester un état valide et stable, jamais interprété comme une anomalie |
| 10 | Notification envoyée alors que la transaction métier a échoué | Notifications toujours **après** commit réussi, jamais dans la transaction (même discipline que le wiring calendrier du lot précédent, `resynchroniserCalendrierPourInterview`/`annulerCalendrierPourInterview`) | Test service : transaction métier échouée (ex. conflit de concurrence) → aucun appel d'envoi d'email déclenché |

---

## 14. Stratégie de tests future

Aucun test n'est écrit ici. Catégories et répartition proposées :

**Tests unitaires (fonctions pures)** :
- `calculerStatutEffectif()` (dérivation EXPIREE/REMPLACEE, §7.2) sur tous les cas limites de date.
- Validation des transitions autorisées (§7.3) — table exhaustive, y compris transitions interdites.

**Tests de service transactionnel** :
- Invariant "au plus une proposition active par Entree" sous concurrence réelle (`Promise.all`, deux contextes).
- Idempotence de l'acceptation (double soumission, §10.2) — assertion sur l'état persisté, pas seulement le code HTTP.
- Refus explicite si la `CandidateFinalDecisionEntree` source n'est pas RETENU/n'existe pas/mauvais tenant.
- Révision/remplacement (`supersedesId`) : chaîne complète, immutabilité des lignes supersédées.
- Immutabilité du snapshot : relecture après modification d'une donnée source (Profil, DemandeTalent) → aucun changement sur la proposition déjà émise.

**Tests API** :
- RBAC complet (403 par rôle non autorisé, y compris INGENIEUR/AGENT).
- Tenant isolation / IDOR (404 uniforme, Client A vs Client B).
- Audit : vérifier l'écriture `journaliser()` sur chaque transition, action unique par type quel que soit le canal (§9).
- Notifications best-effort : échec simulé de l'envoi d'email → la transition métier reste commitée, pas d'exception propagée.
- Mission (préparation uniquement, pas de création dans ce lot) : test de non-régression confirmant qu'aucune route existante ne crée de Mission automatiquement à partir d'un statut `CandidateProposal`.
- Non-régression des décisions finales existantes : `CandidateFinalDecision`/`CandidateFinalDecisionEntree` restent créables/consultables sans aucun changement de comportement, avec ou sans `CandidateProposal` associée.

---

## 15. Revue CTO — A35 : arbitrages D1-D5

Revue effectuée le 11/10/2026, en lecture exclusive du code réel (aucun
fichier applicatif modifié par cette revue). Chaque arbitrage est classé
**LOCKED** / **OPEN** / **EXTERNAL VALIDATION REQUIRED** /
**IMPLEMENTATION DETAIL**, avec règle, justification, alternatives
rejetées, conséquences et dépendances envers les invariants existants.

### D1 — Terminalité de `ACCEPTEE`

**Statut : LOCKED.**

- **Règle** : `ACCEPTEE` est un état terminal et immuable pour la
  `CandidateProposal` elle-même. Toute correction commerciale postérieure
  passe par une nouvelle proposition (append-only, jamais après `ACCEPTEE`)
  ou par une procédure distincte non définie ici (§16). La terminalité de
  la proposition est **indépendante** du succès ou de l'échec de la
  création de `Mission` qui en découle : un échec de création de `Mission`
  ne ramène jamais la proposition à un état antérieur ; la reprise se fait
  en réessayant la création de `Mission` (acte idempotent, §11.2), jamais
  en rejouant l'acceptation (détail complet §7.4).
- **Justification** : évite les risques n°3 (double acceptation) et n°7
  (altération rétroactive) du mandat ; aligné sur le seul précédent
  structurel comparable du dépôt (`Interview.statut`, transitions
  terminales non réversibles).
- **Alternative rejetée** : autoriser une réécriture de `ACCEPTEE` "pour
  permettre une correction rapide" — rejetée car elle rouvre exactement les
  deux risques ci-dessus sans bénéfice métier démontré ; une nouvelle
  proposition (ou une procédure distincte, hors scope) couvre déjà le
  besoin légitime de "changer les termes après coup" sans jamais effacer
  la preuve de la première acceptation.
- **Conséquences sur le futur modèle/tests** : aucune route de
  modification de `CandidateProposal.statut` depuis `ACCEPTEE` ne doit
  exister dans l'implémentation future ; test de non-régression dédié
  (§14) : toute tentative de transition depuis `ACCEPTEE` doit être
  refusée, y compris par l'Admin.
- **Dépendances** : réutilise la discipline déjà verrouillée de
  `Interview.statut` (terminal non réversible) — aucun nouvel invariant
  créé, un invariant existant est étendu par analogie.

### D2 — Prévention des doubles Missions

**Statut : LOCKED (identité, garantie exigée, comportements) + IMPLEMENTATION DETAIL (calendrier d'ajout du champ).**

- **Règle (LOCKED, A35.1)** : identité d'unicité métier = l'id de la
  `CandidateProposal` `ACCEPTEE` elle-même (aucun champ existant de
  `Mission` ne convenait — `sourceDemandeId` est délibérément non unique,
  vérifié §2.3/§11.2). Garantie **exigée** : contrainte `@@unique` sur un
  futur champ additif `Mission.sourceCandidateProposalId` dès que le
  schéma d'implémentation la permet ; transaction Serializable+retry
  **obligatoire** en attendant (jamais "au mieux"). Retry technique
  (`P2034`) ≠ nouvelle intention métier (ex. double-clic) — les deux sont
  distingués et traités par la même garantie. Si une `Mission` référence
  déjà la proposition : mêmes paramètres → réponse idempotente (la
  `Mission` existante) ; paramètres différents → refus explicite, jamais
  une réécriture. Une `Mission` sans référence de provenance n'est
  **jamais** rattachée après coup par heuristique — correction humaine
  explicite uniquement si nécessaire. Détail complet §11.2.
- **Statut (IMPLEMENTATION DETAIL)** : le moment exact d'ajout du champ
  `Mission.sourceCandidateProposalId` au schéma (dès la première
  implémentation ou dans un lot de suivi immédiat) reste un choix
  technique **sans impact sur l'invariant métier** déjà verrouillé —
  aucun schéma n'est modifié par cette revue.
- **Justification** : le modèle `Mission` actuel ne porte aucune référence
  vers une future `CandidateProposal` (vérifié §2.3) — la contrainte DB
  idéale n'existe donc pas encore ; imposer son ajout immédiat
  dépasserait le périmètre de cette revue (interdiction stricte de
  modifier `prisma/schema.prisma`). La garantie transactionnelle
  Serializable+retry est en revanche déjà un pattern **existant et audité**
  dans ce domaine, utilisable sans aucune modification de schéma — elle
  n'est donc plus une option parmi d'autres mais une **obligation** dès ce
  lot.
- **Alternative rejetée** : s'appuyer uniquement sur une vérification
  applicative non transactionnelle ("vérifier puis créer" en deux appels
  séparés) — explicitement exclue par le mandat et par ce document (risque
  de "lost update" identique à celui déjà corrigé dans le lot précédent).
  Également rejetée : une association rétroactive heuristique pour les
  `Mission` sans référence de provenance — explicitement exclue par le
  mandat A35.1.
- **Conséquences** : le futur contrat d'implémentation doit a minima livrer
  la version Serializable+retry (sans modification de schéma requise), et
  prévoir l'ajout du champ `@@unique` dans ce lot ou le suivant immédiat —
  jamais repoussé indéfiniment, puisque c'est la garantie préférée.
- **Dépendances** : `prisma.$transaction(..., { isolationLevel:
  Prisma.TransactionIsolationLevel.Serializable })` + retry `P2034`,
  pattern déjà utilisé trois fois dans le domaine Candidate (création
  d'Interview, réponse à une invitation, création de
  `CandidateFinalDecision`) — aucun nouveau mécanisme introduit.
- **Tests futurs** : création idempotente sous retry simulé (mêmes
  paramètres → même résultat) ; double-clic avec paramètres différents →
  409 explicite ; absence d'association automatique vérifiée sur une
  `Mission` fixture sans provenance.

### D3 — Pinning A18/A19 pour une Mission issue de Candidate Proposal

**Statut : LOCKED (portée minimale) + OPEN (extension future) + LOCKED (ce qui est exclu).**

- **Règle (LOCKED, exclusion)** : `Mission.solutionDecisionId` ne doit
  **jamais** référencer une entité de la chaîne Candidate
  (`CandidateProposal`/`CandidateFinalDecisionEntree`) — vérifié :
  `validerPinsMission()` résout spécifiquement ce champ vers
  `SolutionOption(niveau=DECISION)` et rejetterait ou produirait une
  association sémantiquement fausse pour toute autre origine. Aucune
  relation n'est fabriquée par cette revue.
- **Règle (LOCKED, A35.1, portée minimale)** : pour la première
  implémentation (§11.5), `needVersionId` et `solutionDecisionId` restent
  **tous deux `null`**, sans précondition bloquante — `null` est une
  valeur structurellement valide, déjà majoritaire, acceptée sans
  condition par `validerPinsMission()`. Aucune référence n'est fournie par
  le contexte source dans ce lot ; ce n'est pas une donnée manquante à
  réclamer, c'est un choix de périmètre explicite.
- **Règle (OPEN, extension future)** : peupler `needVersionId` seul
  (option 2, techniquement possible sans modification de code, confirmé
  §11.3) ou introduire un champ dédié (option 3) restent des choix pour un
  lot **ultérieur et séparé**, chacun nécessitant sa propre justification
  métier — absente aujourd'hui.
- **Justification** : le mandat interdit explicitement de déduire
  `needVersionId`/`solutionDecisionId` "depuis une autre entité sans
  contrat explicite" — aucun contrat explicite de ce type n'existe
  aujourd'hui pour la chaîne Candidate. La portée minimale ne nécessite
  donc aucune invention : elle choisit l'absence de référence, seule
  option prouvée sûre par le code existant.
- **Alternative rejetée** : introduire un nouveau champ de pinning "A19"
  pour combler l'absence de définition — rejetée, aucune donnée réelle ne
  justifie d'inventer un invariant portant un nom qui n'existe dans aucun
  code ni contrat du dépôt (confirmé §2.6). Également rejetée : rendre le
  pinning obligatoire et bloquer la création de `Mission` en son absence —
  rejetée car `null` est déjà une valeur valide, bloquer serait inventer
  une contrainte que le code ne justifie pas.
- **Conséquences** : la première implémentation peut créer des `Mission`
  depuis cette chaîne sans jamais toucher à `needVersionId`/
  `solutionDecisionId` — aucune précondition de pinning ne retarde ce
  lot. Une extension future devra documenter sa propre justification avant
  toute migration.
- **Dépendances** : `validerPinsMission()` (A18) reste inchangé — aucune
  modification de cette fonction, dans la portée minimale comme dans
  l'extension future.
- **Tests futurs** : création de `Mission` depuis une `CandidateProposal`
  `ACCEPTEE` → `needVersionId`/`solutionDecisionId` toujours `null` en
  base, aucune erreur, aucune tentative de résolution.

### D4 — Validité de la décision source lors de l'acceptation / après refus

**Statut : LOCKED (obligation à l'acceptation ET à la création d'un successeur).**

- **Règle (LOCKED)** : l'acceptation (`EMISE → ACCEPTEE`/`REFUSEE`) doit
  revérifier, **dans la même transaction Serializable** que l'UPDATE
  conditionnel (§10.2), que la `CandidateFinalDecision` source est toujours
  active (`supersededBy: null`) — réutilisation directe de
  `lireCandidateFinalDecisionActive()`, déjà existant et audité. Une
  décision source supersédée entraîne un refus explicite, jamais un succès
  supposé ; un conflit de sérialisation entraîne un retry (relecture
  fraîche), jamais une résolution optimiste. Détail complet en §10.5.
- **Règle (LOCKED, A35.1)** : le comportement après un refus (ou
  `EXPIREE`/`RETIREE`) est désormais tranché par quatre règles (détail
  complet §10.5) : (1) aucune réactivation automatique de la proposition
  terminée ; (2) aucune réécriture rétroactive de sa décision source ; (3)
  toute proposition **successeur** (`supersedesId`) doit, à sa création et
  dans la même transaction Serializable+retry, revérifier que la
  `CandidateFinalDecisionEntree` cible appartient à la décision **active**
  et porte `statut = RETENU` ; (4) à défaut de décision active valide, la
  création du successeur est **refusée explicitement**.
- **Justification** : contrairement à l'inquiétude soulevée par le mandat
  ("si les décisions existantes ne possèdent pas de mécanisme de
  supersession fiable"), la vérification directe du code
  (`lib/candidate-decision/final-decision.ts`) montre qu'un mécanisme
  fiable **existe déjà** et est directement réutilisable — aucune
  limitation à documenter sur ce point précis. Les quatre règles
  verrouillées par A35.1 réutilisent ce même mécanisme (`supersededBy:
  null`) à un second point de contrôle (la création d'un successeur), pas
  seulement à l'acceptation.
- **Alternative rejetée** : ne vérifier la fraîcheur qu'à l'émission
  (`BROUILLON → EMISE`) et jamais à l'acceptation ni à la création d'un
  successeur — rejetée, car une supersession peut survenir à tout moment
  (fenêtre potentiellement longue), et le mandat exige une vérification
  "lors de l'acceptation" et une garantie que "toute nouvelle proposition
  doit être liée à une décision active". Également rejetée : laisser le
  comportement post-refus non spécifié — le mandat A35.1 exige un
  arbitrage explicite, désormais fourni.
- **Conséquences** : la transaction d'acceptation lit deux invariants
  (statut courant + fraîcheur de la décision source) avant de committer ;
  la transaction de création d'un successeur lit également la fraîcheur de
  la décision cible avant de committer — aucun changement d'isolation
  nécessaire dans les deux cas (déjà Serializable pour d'autres raisons).
- **Dépendances** : `CandidateFinalDecision.supersededBy` (relation
  Prisma déjà existante, inversée de `supersedesId`) — aucune modification
  de ce modèle. `creerCandidateFinalDecisionAvecRetry` comme précédent
  direct du refus explicite sur décision non-active.
- **Tests futurs** : acceptation refusée si la décision source a été
  supersédée entre l'émission et la tentative ; création d'un successeur
  refusée si aucune décision active ne retient plus le candidat ; aucune
  réactivation observée sur une proposition `REFUSEE`/`EXPIREE`/`RETIREE`
  quel que soit l'événement simulé.

### D5 — Portée juridique de l'acceptation

**Statut : LOCKED (séparation conceptuelle) + EXTERNAL VALIDATION REQUIRED (vocabulaire de production).**

- **Règle (LOCKED)** : quatre concepts distincts, jamais fusionnés —
  acceptation enregistrée dans ATLAS (fait technique) / accord commercial
  (fait business externe) / signature d'un contrat juridiquement valable
  (acte juridique externe) / création opérationnelle de Mission (fait
  opérationnel). ATLAS enregistre le premier et le quatrième ; il
  n'affirme jamais avoir produit le deuxième ou le troisième. L'identité de
  l'acteur et l'horodatage sont conservés comme preuve d'un **événement
  applicatif**, jamais comme preuve de consentement juridique. Détail
  complet §12.
- **Règle (EXTERNAL VALIDATION REQUIRED)** : toute formulation visible
  Client ("proposition", "accepté") doit être revue par une expertise
  juridique avant mise en production — **non bloquant pour ce document**
  puisque la frontière ATLAS/externe est déjà explicite (conforme à la
  condition de readiness du mandat §9 : une question juridique externe
  peut rester ouverte si cette frontière est claire).
- **Justification** : aucune recherche juridique n'est faite ou simulée
  ici (conforme à l'instruction du mandat) — la revue se limite à poser la
  séparation conceptuelle correcte, laissant la validation de fond à une
  expertise compétente.
- **Alternative rejetée** : présenter une hypothèse juridique comme un
  avis validé pour "débloquer" le document — explicitement rejetée par le
  mandat et par cette revue.
- **Conséquences** : aucun texte produit par l'implémentation future ne
  doit employer un vocabulaire juridique non validé (ex. "contrat signé",
  "engagement juridique") sans passage par cette revue externe.
- **Dépendances** : aucune — ce point ne dépend d'aucun invariant de code
  existant, uniquement d'une revue humaine hors du périmètre technique.

### Synthèse des statuts (mise à jour A35.1)

| # | Décision | Statut |
|---|---|---|
| D1 | Terminalité de `ACCEPTEE` | **LOCKED** |
| D2 | Identité d'unicité + garantie anti-double-Mission | **LOCKED** (identité, garantie exigée, comportements) / **IMPLEMENTATION DETAIL** (calendrier d'ajout du champ `@@unique`) |
| D3 | Pinning A18/A19 | **LOCKED** (portée minimale : `null` partout, aucune précondition bloquante ; ce qui est exclu) / **OPEN** (extension future, hors première implémentation) |
| D4 | Fraîcheur de la décision source — acceptation et création d'un successeur | **LOCKED** (intégralement : obligation de vérification + quatre règles post-refus) |
| D5 | Portée juridique | **LOCKED** (séparation) / **EXTERNAL VALIDATION REQUIRED** (vocabulaire production) |
| — | Portée minimale de la première implémentation | **LOCKED** — §11.5 |

**Évolution depuis A35** : D2 et D4 sont désormais intégralement `LOCKED`
sur leurs invariants métier (seul un détail d'implémentation sans portée
métier reste ouvert pour D2) ; D3 est `LOCKED` pour la portée minimale
(choix explicite de n'y introduire aucun pin) et ne laisse `OPEN` que
l'extension future, hors périmètre de la première implémentation ; D5 est
inchangé (déjà au maximum de ce qu'une revue technique peut trancher).
**Aucune des quatre ambiguïtés bloquantes citées par le mandat A35 ne
subsiste**, et les quatre points explicitement rouverts par A35.1 sont
désormais résolus ou réduits à des détails d'implémentation non bloquants.

---

## 16. Éléments explicitement hors scope

Verrouillés comme hors scope de ce Design Contract et de toute
implémentation qui en découlerait sans nouvelle validation CTO :

- Schéma Prisma définitif, migration SQL.
- Toute route API, toute page UI.
- Toute modification de `Mission` (y compris les champs additifs
  **discutés** en §11.2/§11.3 — discutés, jamais ajoutés).
- Toute modification du moteur financier (`FinancialResult`, `Facture`,
  calcul de marge).
- Toute dépendance à `WorkItem`, `Deliverable`, `DeliveryEvidence`,
  `DeliveryQualityGate`, Capability Engine, Agentic Runtime, Learning Loop.
- Tarification, taux, montants, formules commerciales (aucun chiffre fixé).
- Signature électronique, fournisseur externe de contrat, scheduler/CRON.
- Révision des termes d'une proposition déjà `ACCEPTEE` (renvoyé en §15 point 1).
- Modification de la chaîne Solution (`ClientNeed`/`SolutionOption`) — domaine parallèle, non touché.
- Toute modification des lots déjà acceptés (Candidate Decision + Interview, Commercial Foundation, A18/A20).

---

## 17. Conditions de readiness pour la phase suivante

Mise à jour par la revue A35 (11/10/2026) puis par la revue complémentaire
**A35.1** (même date). Sur les neuf conditions posées par le mandat (§9),
l'état réel après arbitrage complet est :

| Condition (mandat §9) | État après A35.1 |
|---|---|
| Invariants métier cohérents | **Satisfait** — §4, §5, §7.3 inchangés, aucune incohérence trouvée |
| Autorité Client/Admin claire | **Satisfait** — §8, hérité et verrouillé par CTO Validation §13, non rouvert |
| Modèle préserve l'historique | **Satisfait** — append-only `supersedesId`, EXPIREE/REMPLACEE dérivées (§7.2), confirmé cohérent |
| Acceptation protégée contre double soumission | **Satisfait** — D2 LOCKED (§10.2), obligatoire dès la première implémentation (§11.5) |
| Création de Mission idempotente | **Satisfait** — D2 intégralement LOCKED (identité, garantie exigée, comportements si Mission déjà créée ou sans provenance, §11.2) ; seul le calendrier d'ajout du champ `@@unique` reste **IMPLEMENTATION DETAIL**, sans impact métier |
| Références A18/A19 traitées sans supposition | **Satisfait** — D3 LOCKED pour la portée minimale (aucun pin, aucune précondition bloquante, rien n'est fabriqué) ; l'extension future reste explicitement OPEN et hors périmètre |
| Décisions sources supersédées prises en compte | **Satisfait** — D4 intégralement LOCKED : vérification à l'acceptation **et** à la création d'un successeur, quatre règles post-refus explicites (§10.5) |
| Limites juridiques explicites | **Satisfait** — D5 LOCKED (séparation), EXTERNAL VALIDATION REQUIRED posée sans bloquer (conforme à la tolérance explicite du mandat §9) |
| Aucune dépendance interdite introduite | **Satisfait** — §16/§11.5 inchangés, aucune dépendance à WorkItem/Deliverable/Capability Engine/Agentic Runtime/Learning Loop |

**Lecture du mandat §9 (A35.1)** : *"une ambiguïté sur l'identité de la
proposition, l'autorité de l'acceptation, la validité de la décision
source ou la garantie anti-double-Mission bloque le passage à
l'implémentation."* Vérifié un par un après A35.1 : l'identité de la
proposition est fixée (§5.1) ; l'autorité de l'acceptation est fixée
(§8) ; la validité de la décision source est intégralement couverte (D4,
LOCKED, aux deux points de contrôle) ; la garantie anti-double-Mission est
intégralement couverte (D2, LOCKED, identité + garantie + comportements).
**Aucune des quatre ambiguïtés bloquantes ne subsiste — y compris les
quatre points explicitement rouverts par A35.1, désormais tous résolus.**

Il reste, avant de rédiger le contrat d'implémentation :

1. Ajouter `Mission.sourceCandidateProposalId` (`@@unique`) au schéma dès
   ce lot ou le suivant immédiat — **IMPLEMENTATION DETAIL**, borné par
   l'obligation déjà verrouillée (D2) d'avoir au moins Serializable+retry
   en attendant.
2. Documenter, si et quand l'extension D3 (pinning `needVersionId`) est un
   jour engagée, sa justification métier propre — **hors périmètre de la
   première implémentation**, non bloquant pour celle-ci.
3. Engager, en parallèle et sans bloquer le travail technique, la revue
   juridique externe de D5 (vocabulaire de production).

Aucun de ces trois points n'est une "ambiguïté bloquante" au sens du
mandat §9 — chacun est soit un détail d'implémentation borné par un
invariant déjà verrouillé, soit explicitement hors périmètre, soit une
validation externe non bloquante par construction.

---

## Annexe — Réponses directes aux critères de sortie du mandat (§12)

- **Avons-nous réellement besoin d'un nouvel objet Proposal ?** Oui —
  confirmé par §2.2 (compatibilité déjà préparée, jamais implémentée) et
  §2.4 (aucun objet existant n'a de notion d'« attente de réponse »
  commerciale par candidat).
- **Quel événement métier autorise sa création ?** Une
  `CandidateFinalDecisionEntree` avec `statut = RETENU`, dans son état
  actif (non supersédé) — §3, §13 risque 1.
- **Qui peut l'émettre et qui peut l'accepter ?** Émission : ADMIN
  uniquement. Acceptation/refus : CLIENT exclusivement, ou ADMIN
  enregistrant pour son compte hors-système — §8.
- **Comment les révisions et remplacements préservent-ils l'historique ?**
  `supersedesId`/`supersededBy`, append-only, aucune réécriture — §5.3, §7.2.
- **Quand une Mission peut-elle être créée ?** Jamais automatiquement ;
  seulement par un acte Admin explicite (`POST /api/missions` existant),
  rendu possible (pas déclenché) par `ACCEPTEE` — §11.
- **Comment éviter les doublons et les incohérences transactionnelles ?**
  Serializable+retry (pattern déjà audité dans ce domaine) + UPDATE
  conditionnel atomique — §10.
- **Quelles données commerciales doivent être figées ?** Les conditions
  proposées (valeurs non fixées ici) + l'horodatage d'émission/validité —
  §6.2. Aucune donnée opérationnelle (compétences, critères, disponibilité
  courante) n'est jamais copiée — §6.3.
- **Quelles décisions restent à valider avant toute implémentation ?**
  Depuis les revues A35 puis A35.1 (§15) : cinq invariants métier
  structurants sont désormais **LOCKED** (terminalité d'`ACCEPTEE` ;
  identité d'unicité et garantie anti-double-Mission, y compris le
  comportement si une Mission existe déjà ou sans provenance ; absence de
  pin A18 pour la portée minimale, sans précondition bloquante ;
  obligation de revérifier la fraîcheur de la décision source à
  l'acceptation et à la création d'un successeur, avec les quatre règles
  post-refus ; séparation acceptation ATLAS/portée juridique). Reste
  **OPEN**, explicitement hors périmètre de la première implémentation :
  l'extension future du pinning A18 pour la chaîne Candidate. Reste
  **IMPLEMENTATION DETAIL**, sans impact métier : le calendrier d'ajout du
  champ `Mission.sourceCandidateProposalId`. Reste **EXTERNAL VALIDATION
  REQUIRED**, non bloquant : la revue juridique du vocabulaire de
  production.
