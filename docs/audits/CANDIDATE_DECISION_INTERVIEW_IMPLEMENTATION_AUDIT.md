# ATLAS — CANDIDATE DECISION + INTERVIEW — INDEPENDENT IMPLEMENTATION AUDIT

Audit indépendant, lecture seule. Aucun code applicatif, schéma Prisma, migration,
API, UI ou suite de tests n'a été modifié pour produire ce document. Aucune
correction n'a été appliquée aux problèmes découverts.

Méthode : chaque affirmation du rapport d'implémentation précédent a été
re-vérifiée contre le code réel, le SQL réel, et des exécutions de tests non
destructives — jamais acceptée comme vraie simplement parce qu'elle figure dans
ce rapport. Les distinctions suivantes sont tenues tout au long du document :

- **FAIT VÉRIFIÉ** = confirmé directement par lecture de code, requête SQL en
  lecture seule, ou exécution de test dans cette session d'audit.
- **AFFIRMATION DU RAPPORT PRÉCÉDENT** = ce que le rapport d'implémentation
  prétend, non encore vérifié indépendamment au moment de la citation.
- **HYPOTHÈSE** = déduction raisonnable non confirmée par preuve directe.
- **NON VÉRIFIABLE** = hors de portée de cet environnement (ex. configuration
  de production réelle, secret réel, cron réel).

---

## 1. HEAD initial et final

```
git rev-parse HEAD   → 265f0a8be2a6d162fbaa911293ccad3691f3a58e
git log -1 --oneline → 265f0a8 feat(atlas): add learning loop runtime
```

**FAIT VÉRIFIÉ** : HEAD correspond exactement au hash attendu
(`265f0a8be2a6d162fbaa911293ccad3691f3a58e`), inchangé du début à la fin de cet
audit. Aucun commit créé pendant cet audit (vérifié par une seconde exécution de
`git rev-parse HEAD` en fin de session, §15).

## 2. État initial et final du working tree

**FAIT VÉRIFIÉ** : `git status --short` retourne **88 entrées** à l'ouverture de
cet audit et **88 entrées** à sa clôture (compte identique, voir §15) — aucun
fichier ajouté, supprimé ou modifié par cet audit lui-même, à l'exception du
présent document d'audit (nouveau fichier, seule écriture de cette session).
Le working tree mélange des modifications de **plusieurs lots antérieurs non
committés** (Engineer Access & Trust, A34 Learning Loop, Decision Context,
Agentic Runtime, DB-0x UI, etc.) avec les fichiers du lot Candidate Decision +
Interview — voir §4 pour l'attribution précise. Les trois artefacts protégés
(`next-env.d.ts`, `package-lock.json`, `tsconfig.tsbuildinfo`) restent non suivis
(`??`) sans modification ni restauration de la part de cet audit.

`git diff --check` : aucune erreur d'espace, avant comme après.

## 3. Documents contractuels examinés

Les trois documents sont présents et ont été lus intégralement :

- `docs/architecture/CANDIDATE_DECISION_INTERVIEW_DESIGN_CONTRACT.md` (571 lignes)
- `docs/architecture/CANDIDATE_DECISION_INTERVIEW_CTO_VALIDATION.md` (525 lignes)
- `docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md` (806 lignes)

**FAIT VÉRIFIÉ** : les trois fichiers existent et leur contenu correspond à ce
que le rapport d'implémentation précédent décrit dans ses grandes lignes. Le
contenu exact de deux clauses non-négociables de la CTO Validation (§5, §21.3)
a une conséquence directe et sévère sur ce verdict — voir §12.

## 4. Inventaire des changements attribuables au lot

**FAIT VÉRIFIÉ**, par lecture de chaque hunk de diff (pas seulement du nom de
fichier) :

### 4.1 Attribuables à ce lot, sans ambiguïté (fichiers neufs)

```
prisma/migrations/20261011125317_candidate_decision_interview/
lib/candidate-selection/service.ts
lib/interview/service.ts
lib/interview/evaluation.ts
lib/interview/reminders.ts
lib/candidate-decision/final-decision.ts
lib/calendar/sync.ts
app/api/client/talent-selection/**  (8 routes)
app/api/talent/demandes/[id]/interviews/**  (3 routes)
app/api/talent/demandes/[id]/final-decision/route.ts
app/api/talent/demandes/[id]/selections/route.ts
app/api/interviews/[interviewId]/participants/[participantId]/reponse/route.ts
app/api/internal/interview-reminders/process/route.ts
app/client/talent/SelectionEtEntretiens.tsx
app/admin/talent/[id]/InterviewsAdmin.tsx
tests/api/candidate-decision-interview.spec.ts
```

### 4.2 Attribuables à ce lot, fichiers existants modifiés

- `prisma/schema.prisma` — **100 % du diff est attribuable à ce lot** (vérifié :
  `git diff -- prisma/schema.prisma | grep "^-"` retourne **zéro ligne
  supprimée** ; le bloc ajouté est intégralement délimité par le commentaire
  banner "ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026)", sans aucun autre
  marqueur de lot dans ce fichier).
- `lib/validation.ts` — 100 % du diff attribuable (même vérification, un seul
  marqueur de lot présent dans le diff).
- `.env.example` — 100 % attribuable (un seul bloc ajouté, relatif à
  `INTERVIEW_REMINDER_INTERNAL_SECRET`).
- `app/client/talent/page.tsx` — 2 lignes ajoutées (import + rendu de
  `SelectionEtEntretiens`), 100 % attribuable.
- `app/admin/talent/[id]/page.tsx` — 2 lignes ajoutées (import + rendu de
  `InterviewsAdmin`), 100 % attribuable.
- **`lib/email.ts` — ATTRIBUTION MIXTE, correction au rapport précédent.** Le
  diff contient deux blocs distincts : lignes ~40–91 portent le commentaire
  "ENGINEER ACCESS & TRUST (09/10/2026)" (`envoyerEmailCompteRefuse`,
  `envoyerEmailInformationsDemandees`) — **PAS attribuable à ce lot**, c'est une
  modification préexistante d'un lot antérieur déjà présente avant le début de
  ce lot. Seuls sont attribuables à Candidate Decision + Interview : le
  changement de signature de `envoyerEmail()` (retour `void` → `Promise<boolean>`,
  nécessaire pour que `lib/interview/reminders.ts` distingue ENVOYE d'ECHEC) et
  les 6 nouveaux templates à partir du commentaire "ATLAS CANDIDATE DECISION +
  INTERVIEW" (ligne ~92 du diff). Le rapport d'implémentation précédent n'a pas
  fait cette distinction explicitement — **Statut : PARTIAL sur la précision de
  l'attribution, sans impact sur la validité technique du changement**.

### 4.3 Non attribuables à ce lot (modifications préexistantes, à ne jamais imputer à CDI)

Tous les autres fichiers listés par `git status --short` à l'ouverture de cet
audit — notamment `middleware.ts`, `lib/auth.ts`, `lib/agentic/runtime.ts`,
`lib/learning-loop/*`, `lib/security/events.ts`, les routes
`app/api/comptes/*`/`app/api/ingenieur/cv/*`/`app/api/auth/*`, et tous les
fichiers non listés en §4.1/§4.2 — appartiennent à des lots antérieurs non
committés. Aucun n'a été modifié par cet audit ni par le lot audité.

### 4.4 Attribution incertaine, nécessitant mention explicite

- `app/api/talent/demandes/[id]/selections/route.ts` — route de lecture pour
  l'Admin, **non listée explicitement dans la table API §15 de l'Implementation
  Contract** (qui ne liste que les routes Interview/Final Decision côté Admin).
  Le rapport précédent la justifie par la règle de visibilité §3 ("ADMIN voit
  toutes les sélections de ses DemandeTalent") — **FAIT VÉRIFIÉ** : cette règle
  existe bien dans la CTO Validation §15, donc la route répond à un besoin réel,
  mais elle constitue une extension de périmètre au-delà de la liste exacte de
  routes du contrat, à signaler explicitement plutôt qu'à passer sous silence.
  **Statut : PARTIAL — justifiée par une règle réelle, mais hors de la liste
  contractuelle explicite.**

## 5. Conformité du schéma Prisma

**FAIT VÉRIFIÉ** (lecture complète de `prisma/schema.prisma` lignes 1607–1858) :

- 7 objets principaux présents : `CandidateSelection`, `Interview`,
  `InterviewParticipant`, `InterviewEvaluation`, `CandidateFinalDecision`,
  `InterviewReminder`, `CalendarSyncRecord`.
- Objet auxiliaire `CandidateFinalDecisionEntree` présent, distinct de
  `CandidateFinalDecision`.
- 10 enums présents et comptés : `CandidateSelectionStatut`, `InterviewStatut`,
  `InterviewCanal`, `InterviewParticipantRole`, `StatutInvitation`,
  `AppreciationCritere`, `RecommandationEvaluation`,
  `CandidateFinalDecisionStatutEntree`, `InterviewReminderStatutEnvoi`,
  `CalendarSyncStatut` — compte exact.
- `InterviewParticipantRole` a exactement 4 valeurs
  (`CANDIDAT|CLIENT|ADMIN_RECRUTEUR|INTERVIEWEUR_INTERNE`) — **confirme le
  renommage `INTERVIEWEUR_TECHNIQUE → INTERVIEWEUR_INTERNE` exigé par la CTO
  Validation §21 condition 5**. PASS.
- `telephoneInterview` est scopé à `InterviewParticipant`, absent de `Profil` —
  **FAIT VÉRIFIÉ** par grep sur `model Profil` (aucun champ téléphone). Conforme
  à la CTO Validation §5. PASS.
- `ShortlistEntree`/`DemandeTalent` : **zéro suppression** dans le diff
  (`git diff -- prisma/schema.prisma | grep "^-"` → vide), seules deux relations
  inverses ajoutées (`candidateSelections`, `finalDecisions`/`candidateSelections`
  sur `DemandeTalent` ; `candidateSelections` sur `ShortlistEntree`). PASS, aucune
  modification hors scope.

**Statut global §5 : PASS.**

## 6. Conformité de la migration SQL

**FAIT VÉRIFIÉ** (lecture + requêtes non destructives) :

```
grep -ci "DROP\|ALTER COLUMN" migration.sql → 0
grep -c "CreateTable" → 8   (7 objets + CandidateFinalDecisionEntree)
grep -c "CreateEnum"  → 10
grep -c "AddForeignKey" → 12
```

`npx prisma migrate status` → *"Database schema is up to date!"*
`npx prisma migrate diff --from-url <atlas_ci> --to-schema-datamodel schema.prisma --script`
→ *"This is an empty migration."* (zéro dérive entre schéma et base réelle).

**Statut §6 : PASS, vérifié indépendamment, zéro dérive, zéro statement destructif.**

## 7. Audit des sélections

Lecture complète de `lib/candidate-selection/service.ts`.

| Règle | Statut | Preuve |
|---|---|---|
| Au plus une `ACTIVE` par `shortlistEntreeId` | **PASS** | Relecture `findFirst` DANS la transaction `Serializable` avant `create` (lignes 67–74), retry sur `P2034` (lignes 85–98) |
| Transitions contrôlées | **PASS** | `retirerCandidateSelection` vérifie `statut === "ACTIVE"` avant `RETIREE` (ligne 122) ; aucune voie de réactivation |
| Opérations concurrentes sous `Serializable`+retry | **PASS** | `Prisma.TransactionIsolationLevel.Serializable` explicite sur les deux opérations d'écriture |
| Pas de contournement tenant/demande | **PASS** | `shortlistEntree.demandeId !== params.demandeTalentId` revérifié dans le service, en plus de la route (lignes 60–62) |

**Statut §7 : PASS.**

## 8. Audit des entretiens

Lecture complète de `lib/interview/service.ts`.

| Règle | Statut | Preuve |
|---|---|---|
| Exactement un organisateur | **PASS** | Validé sur l'input (`validerParticipants`, ligne 112) **et** relu après persistance dans la même transaction (lignes 163–164) |
| Exactement un CANDIDAT avec `profilId` | **PASS** | Ligne 115 |
| Transitions verrouillées | **PASS** | `TRANSITIONS_AUTORISEES` (lignes 330–334) correspond exactement au lifecycle de la CTO Validation §7 : `ANNULE`/`ABSENT` depuis `PLANIFIE`\|`CONFIRME`, `TERMINE` uniquement depuis `CONFIRME` |
| Champs figés au reschedule | **PASS** | `reprogrammerInterview` ne réécrit jamais `statut` (ligne 296–304), seuls `dateHeure`/`dureeMinutes`/`canal`/`lieu` |
| `peutConfirmer()` exact | **PASS** | Ligne 83–86, byte-pour-byte identique au pseudo-code du contrat §8 (filtre `requis`, `every`, aucune agrégation) |
| Réponses → transitions automatiques | **PASS** | Refus requis → `ANNULE` (ligne 248–259) ; `PLANIFIE` + `peutConfirmer` → `CONFIRME` (ligne 266–268) ; confirmé par test (§18) |
| **Double requête / concurrence sans état contradictoire** | **FAIL (confirmé par lecture, non testé par la suite dédiée)** | Voir §8.1 ci-dessous |

### 8.1 FINDING — fenêtre de "lost update" sur la transition CONFIRME sous réponses concurrentes

**Statut : CONFIRMED (par lecture de code), sévérité MOYENNE, non bloquant pour
ce lot, correction recommandée.**

`enregistrerReponseInvitation` (lignes 219–272) s'exécute dans une transaction
**par défaut (pas `Serializable`)** — choix explicitement documenté par le
contrat lui-même (§14 : "pas de concurrence multi-lignes à protéger"). Cette
justification ne résiste pas à la lecture du code : la décision `peutConfirmer`
dépend de **l'état de tous les participants requis**, pas seulement de la ligne
mise à jour par l'appel courant. Scénario concret :

1. Un `Interview` a 2 participants requis (CANDIDAT A, organisateur B), tous deux
   `EN_ATTENTE`.
2. A et B répondent `ACCEPTEE` quasi simultanément, chacun via son propre appel
   (ex. deux liens email cliqués à la même seconde).
3. La transaction de A lit l'état des participants **avant** que la transaction
   de B ait committé son update sur B (lecture sous isolation par défaut,
   `READ COMMITTED` côté Postgres) → `peutConfirmer([A=ACCEPTEE, B=EN_ATTENTE])`
   = `false`.
4. Symétriquement, la transaction de B peut lire A comme encore `EN_ATTENTE` →
   `peutConfirmer([A=EN_ATTENTE, B=ACCEPTEE])` = `false`.
5. Résultat : A et B sont bien tous deux `ACCEPTEE` en base, mais
   `Interview.statut` reste `PLANIFIE` — la transition `CONFIRME` est
   silencieusement manquée.

**Facteur atténuant, vérifié par lecture** : cette anomalie est **auto-réparée**
par toute réponse ultérieure d'un participant supplémentaire (un participant
non-requis qui répond relit alors un état à jour et recalcule correctement
`peutConfirmer`). Si l'`Interview` n'a **que** les 2 participants requis et
qu'aucun autre événement ne se produit, l'état incorrect peut persister
indéfiniment.

**Non couvert par le test dédié** : le test "critère CONFIRME" de
`tests/api/candidate-decision-interview.spec.ts` (ligne 224) enchaîne les
acceptations **séquentiellement** (`await` un par un), jamais en concurrence
réelle (`Promise.all`) — il prouve la logique séquentielle correcte, pas la
sûreté sous concurrence réelle. **Exactement le piège que ce mandat d'audit
demandait de ne pas confondre ("test vert" ≠ "règle couverte").**

**Action requise (non exécutée)** : soit passer `enregistrerReponseInvitation`
en isolation `Serializable`+retry `P2034` (cohérent avec le reste du dépôt),
soit ajouter une relecture explicite post-commit si `peutConfirmer` était
`false`. Ajouter un test de concurrence réelle (`Promise.all` sur deux réponses
simultanées) pour prouver la correction.

## 9. Audit des évaluations

Lecture complète de `lib/interview/evaluation.ts`.

| Règle | Statut | Preuve |
|---|---|---|
| Pas d'écrasement d'une évaluation existante | **PASS** | Aucun `update` sur `InterviewEvaluation`, uniquement `create` |
| Corrections via `supersedesId` | **PASS** | Lignes 156–171, avec vérification `DejaSupersedeError` (relecture `findFirst` + filet P2002) |
| Ownership réelle (participant ACCEPTEE) | **PASS** | Ligne 148–149, résolution par `emailParticipant` sur CET `Interview`, jamais une permission globale |
| `evaluateurRole` non falsifiable | **PASS** | Ligne 151, snapshot dérivé du `InterviewParticipant` réel, jamais accepté en paramètre (confirmé : le type `CreationInterviewEvaluationParams` n'a pas de champ `evaluateurRole`) |
| Visibilité vérifiée côté serveur | **PASS** | `evaluationVisiblePour` (ligne 219–226) appelée dans les routes GET Client (filtre appliqué avant sérialisation JSON), jamais seulement côté UI — confirmé par test (§18 : une évaluation ADMIN_RECRUTEUR est absente de la réponse JSON Client, pas seulement masquée visuellement) |

**Statut §9 : PASS.**

## 10. Audit des décisions finales

Lecture complète de `lib/candidate-decision/final-decision.ts` et des deux routes
(`app/api/client/talent-selection/demandes/[demandeId]/final-decision/route.ts`,
`app/api/talent/demandes/[id]/final-decision/route.ts`).

| Règle | Statut | Preuve |
|---|---|---|
| CLIENT seul acteur autorisant une décision pour son propre compte | **PASS** | `decideParRole` hardcodé `"CLIENT"` dans la route Client (jamais lu depuis le body) |
| ADMIN ne décide jamais à la place du Client | **PASS** | Service rejette (`CommuniqueHorsSystemeRequisError`) toute décision `decideParRole !== "CLIENT"` sans `communiqueParClientHorsSysteme: true` + `canalHorsSysteme` renseigné (lignes 121–134) ; route Admin impose en plus `z.literal(true)` sur ce champ au niveau zod — double verrouillage |
| Append-only | **PASS** | Uniquement `create`, jamais `update` sur `CandidateFinalDecision`/`Entree` |
| Unicité de la décision active sous concurrence | **PASS** | Relecture `findFirst({supersededBy: null})` DANS une transaction `Serializable`, retry `P2034` (lignes 144–157, 180–195) |
| `NON_RETENU` sans justification rejeté | **PASS** | `validerEntrees` lève `JustificationRequiseError` si `justification` absente/vide pour `NON_RETENU` (ligne 98) |
| Aucune évaluation ne déclenche une décision | **PASS** | Confirmé par lecture (aucun import croisé entre les deux modules) et par test (§18 : zéro `CandidateFinalDecision` créée après une séquence d'évaluations) |
| Aucune IA ne décide | **PASS** | Aucune référence à un provider IA/LLM dans tout le fichier, confirmé par lecture intégrale |

**Statut §10 : PASS — c'est l'invariant le plus critique du mandat (autorité
exclusive du Client), et c'est le mieux vérifié : double verrouillage
service+route, transaction correcte, testé explicitement (§18).**

## 11. RBAC et tenant isolation

**FAIT VÉRIFIÉ** par grep systématique sur les 13 routes à session (hors route à
jeton et endpoint interne) : chacune ouvre par
`if (!session || session.role !== "X" ...)` — jamais une valeur lue du corps de
la requête, jamais un rôle implicite.

**FAIT VÉRIFIÉ**, re-lecture de `middleware.ts` — **correction factuelle au
rapport précédent** : le rapport affirmait que `/api/talent/*` n'était "pas dans
le matcher middleware". C'est **faux** : `/api/talent/:path*` **est** dans
`config.matcher` (ligne 215) et dans `TALENT_PREFIXES`. Le comportement réel
(vérifié en lisant les lignes 90–150) : le middleware exige une session valide
pour tout `/api/talent/*`, laisse passer CLIENT et ADMIN (mais pas INGENIEUR,
explicitement exclu), et **chaque route reste individuellement responsable** du
rôle exact exigé — exactement la discipline "defense in depth" déjà documentée
dans ce même fichier pour `SHARED_PREFIXES`. Cette correction n'a **aucune
conséquence de sécurité** : les routes Admin de ce lot (`interviews`,
`final-decision`, `selections`) vérifient toutes `session.role !== "ADMIN"`
elles-mêmes (confirmé §4.1/§8), donc un CLIENT laissé passer par le middleware
reçoit bien un 403 de la route elle-même. **Statut : correction d'attribution,
pas un problème de sécurité.**

Tenant isolation : **FAIT VÉRIFIÉ** sur toutes les routes lues — chaque lecture
remonte la chaîne réelle (`selection.demandeTalentId` → `demandeTalent.clientId`,
ou `interview.candidateSelection.demandeTalentId` → `clientId`), jamais une
vérification d'existence seule. Confirmé par test (§18, IDOR Client A/B → 404
uniforme).

**Statut §11 : PASS**, avec une correction d'attribution sans impact sécurité.

## 12. Confidentialité et IDOR

### 12.1 Identité du candidat (nom/prénom) — PASS

**FAIT VÉRIFIÉ** : `GET /api/client/talent-selection/selections/[selectionId]/profil`
résout l'identité exclusivement via `selectionId → ShortlistEntree → Profil`
(aucun `profilId` accepté en paramètre, confirmé par lecture et par test §18 :
`selections/id-inexistant/profil` → 404). La réponse ne contient que
`{nom, prenom}` (vérifié par lecture, confirmé par test : `corps.email`/
`corps.telephone` sont `undefined`). Révélation auditée via `objet.consultation`
(`enregistrerEvenementSecurite`, action générique existante, pas une nouvelle
entrée de vocabulaire — conforme à la CTO Validation §16).

### 12.2 Logs et liens vidéo — PASS

**FAIT VÉRIFIÉ** par grep sur `cible:`/`detail:` dans toutes les routes de ce
lot (§4 ci-dessus) : uniquement des identifiants techniques (`demande:X
selection:Y`), jamais une valeur d'identité, jamais `meetingUrl`.

### 12.3 FINDING CRITIQUE — fuite de `score`/`confiance`/`motifs` vers le Client, violant une condition non-négociable verrouillée par le CTO

**Statut : CONFIRMED, sévérité ÉLEVÉE.**

La CTO Validation §5 pose, en caractères explicites, une **condition non
négociable pour le futur Implementation Contract**, reprise à l'identique en
§21 point 3 :

> *"score/confiance/motifs (ShortlistEntree.motifs) ne doivent **jamais**
> apparaître dans cette nouvelle route — seuls les champs déjà jugés sûrs pour
> CandidatAnonyme (...) sont exposables."*
> *"3. score/confiance/motifs jamais sérialisés dans une route Client (§5)."*

**FAIT VÉRIFIÉ par lecture directe du code réel** (pas une supposition) :

- `app/api/client/talent-selection/demandes/[demandeId]/shortlist/route.ts`,
  lignes 58–60 : la réponse JSON inclut littéralement
  `score: entree.score, confiance: entree.confiance, motifs: entree.motifs`.
- `app/api/client/talent-selection/demandes/[demandeId]/comparison/route.ts`,
  ligne 52 : la réponse JSON inclut
  `matching: { score: ..., confiance: ..., motifs: ... }`.
- `app/client/talent/SelectionEtEntretiens.tsx`, ligne 269 : le score est
  **rendu visuellement au Client** : `` `score matching {Math.round(c.matching.score * 100)}%` ``.

Le rapport d'implémentation précédent **documente explicitement cet écart**
(commentaire en tête du fichier `shortlist/route.ts`, lignes 14–27) comme une
"adaptation nécessaire" face à un problème réel (le DTO `CandidatAnonyme` n'est
pas persisté tel quel sur `ShortlistEntree`, seuls `score`/`confiance`/`motifs`
le sont) — mais **ne traite jamais la question de savoir si exposer ces trois
champs eux-mêmes viole une règle distincte, plus explicite et non négociable**.
C'est exactement le cas : la CTO Validation ne demandait pas de reproduire le
DTO `CandidatAnonyme` à l'identique — elle demandait, **séparément et de façon
non négociable**, que `score`/`confiance`/`motifs` ne soient **jamais**
sérialisés vers le Client, quelle que soit la forme de la réponse. Le "jamais"
est sans ambiguïté et sans condition.

Ceci recoupe aussi le Non-Goal explicite du Design Contract §24 : *"aucun score
opaque"* — un pourcentage de matching brut affiché au Client, sans explication
factuelle, est précisément ce que cette règle interdit.

**Aucun test ne couvre cette règle.** La CTO Validation §5 exige pourtant
explicitement : *"Un test dédié de non-fuite (...) est un **prérequis au
merge**, pas un test parmi d'autres."* Le test existant
(`tests/api/candidate-decision-interview.spec.ts`, describe "Confidentialité")
vérifie uniquement l'absence de fuite de `REJETEE`/`SUGGEREE` et d'identité —
**jamais** l'absence de `score`/`confiance`/`motifs`. Le rapport précédent
affirme à tort une couverture suffisante de ce point.

**Impact métier** : expose au Client un score de matching brut et ses
pondérations internes (`motifs`), permettant une forme de "score shopping"
(sélection biaisée par un chiffre plutôt que par les faits qualitatifs), ce que
tout le programme ATLAS interdit explicitement ailleurs (`besoin/matcher`
existant n'expose jamais ces champs, uniquement `explication`/`pointsForts`/
`pointsAmeliorer`).

**Action requise (non exécutée par cet audit)** : retirer `score`/`confiance`/
`motifs` des deux réponses JSON et de l'UI Client ; les remplacer, si une
justification factuelle doit être montrée, par une dérivation textuelle à partir
de `motifs` (ex. une liste de `detail` sans le poids numérique), cohérente avec
ce que `besoin/matcher` fait déjà pour `CandidatAnonyme`. Ajouter le test de
non-fuite explicitement exigé par la CTO Validation §5.

### 12.4 IDOR sur le jeton de réponse — PASS

**FAIT VÉRIFIÉ par test** (`tests/api/candidate-decision-interview.spec.ts`,
describe "RBAC / IDOR", dernier test) : un jeton valide pour le participant A,
utilisé pour répondre à la place du participant B, est refusé (403) — confirmé
par re-exécution indépendante (§18). Le jeton lie `interviewId`+`participantId`
dans la ressource signée elle-même (`lib/url-signee.ts`), IDOR exclu par
construction plutôt que par une vérification applicative séparée.

**Statut global §12 : FAIL** sur le point non négociable §12.3 (sévérité
élevée, mais correction précise et bornée) ; **PASS** sur tous les autres points
(identité, logs, IDOR jeton).

## 13. Email

Lecture de `lib/email.ts` (partie attribuable, §4.2) et des 6 templates.

**FAIT VÉRIFIÉ** : 6 templates présents
(`envoyerEmailInvitationEntretien`, `envoyerEmailConfirmationEntretien`,
`envoyerEmailRefusEntretien`, `envoyerEmailModificationEntretien`,
`envoyerEmailAnnulationEntretien`, `envoyerEmailRappelEntretien`), tous
best-effort via `envoyerEmail()` (try/catch interne, jamais de throw propagé).
Tous les appels dans les routes sont précédés de `void` (fire-and-forget) et
placés **après** la transaction qui persiste l'état métier — confirmé par
lecture de chaque route d'écriture (`interviews/route.ts`,
`interviews/[interviewId]/route.ts`, `reponse/route.ts`). Un échec email ne peut
donc jamais rendre un état métier incohérent (la transaction a déjà committé).

**Statut §13 : PASS.**

## 14. Calendrier

Lecture complète de `lib/calendar/sync.ts`.

**FAIT VÉRIFIÉ** : `resoudreProvider()` (ligne 50) retourne littéralement et
systématiquement `null` — confirmé par lecture directe, pas une inférence.
Aucune variable d'environnement de provider calendrier n'existe (confirmé par
grep sur l'ensemble du dépôt). Aucun appel réseau réel n'est possible dans ce
lot. **La structure existe, la synchronisation réelle n'existe pas** —
distinction maintenue, conforme à ce que le rapport précédent affirme sur ce
point précis.

### 14.1 FINDING — le reschedule et l'annulation ne sont PAS câblés au cycle de vie réel de l'Interview

**Statut : CONFIRMED, sévérité MOYENNE, impact actuel nul (provider toujours
null), impact latent réel si un provider est un jour connecté.**

`resynchroniserApresReprogrammation` et `annulerSync` existent dans
`lib/calendar/sync.ts` et implémentent exactement ce que la CTO Validation §9 et
l'Implementation Contract §11 exigent (réutilisation de `externalEventId`,
`statutSync: ANNULE_EXTERNE`). **Mais** :

```
grep -rn "resynchroniserApresReprogrammation\|annulerSync\|resynchroniserEchecs" \
  --include="*.ts" --include="*.tsx" . | grep -v "lib/calendar/sync.ts"
→ (aucun résultat)
```

**FAIT VÉRIFIÉ** : ces trois fonctions ne sont appelées **par aucun autre
fichier du dépôt**. En particulier, `lib/interview/service.ts::reprogrammerInterview`
et `transitionnerInterview` (qui gèrent respectivement le reschedule et
l'annulation réels de l'`Interview`) n'importent ni n'appellent jamais
`lib/calendar/sync.ts` — seule la création après acceptation
(`declencherSyncApresAcceptation`, appelée depuis la route de réponse à jeton)
est réellement câblée. `resynchroniserEchecs` (le job de retry) n'est exposé par
aucune route et n'est appelé par rien.

**Conséquence** : le jour où un vrai provider sera branché dans
`resoudreProvider()`, un reschedule ou une annulation d'`Interview` ne
déclenchera **aucune** mise à jour ou annulation de l'événement externe
correspondant — contredisant directement le texte de la CTO Validation §9 et de
l'Implementation Contract §11. La prétention du rapport précédent selon laquelle
le mécanisme est *"prêt pour qu'un futur lot d'intégration réelle s'y branche
sans redesign"* est **inexacte** pour les chemins reschedule/annulation : un
futur lot devrait d'abord ajouter le câblage manquant dans
`lib/interview/service.ts`, ce qui n'est pas un simple branchement de provider.

**Action requise (non exécutée)** : appeler `resynchroniserApresReprogrammation`
depuis `reprogrammerInterview` (après le `tx.interview.update`) et `annulerSync`
depuis `transitionnerInterview` pour `versStatut === "ANNULE"`, pour chaque
`InterviewParticipant` concerné. Sans impact pratique immédiat tant qu'aucun
provider n'est connecté, mais à corriger avant toute intégration réelle future.

**Statut §14 : PARTIAL** — la non-intégration réelle est honnêtement documentée
(pas de simulation de succès), mais le câblage interne reschedule/annulation
manque, contrairement à ce que le rapport précédent affirme.

## 15. Vidéo

**FAIT VÉRIFIÉ** : `meetingProvider`/`meetingUrl`/`meetingExternalId` sont des
champs `String?` nullable sur `Interview`, jamais lus ni écrits par aucun appel
réseau (confirmé par grep : aucune bibliothèque de vidéoconférence importée
nulle part dans le dépôt). Aucun fournisseur connecté — champs de saisie libre
uniquement, conforme à la CTO Validation §14.

**Statut §15 : PASS.**

## 16. Rappels et endpoint interne

Lecture complète de `lib/interview/reminders.ts` et
`app/api/internal/interview-reminders/process/route.ts`.

| Règle | Statut | Preuve |
|---|---|---|
| Authentification de l'endpoint interne | **PASS** | En-tête `x-internal-secret`, fail-closed si `INTERVIEW_REMINDER_INTERNAL_SECRET` absent/vide (lignes 45–51) |
| Comparaison à temps constant | **PASS** (avec une imprécision de commentaire, voir note) | `crypto.timingSafeEqual` sur deux buffers de longueur fixe (digest SHA-256), jamais une comparaison `===` directe sur le secret brut |
| Secret jamais loggé | **PASS** | Les deux branches d'échec (`console.error`) ne contiennent que des messages fixes, jamais `secretFourni`/`secretAttendu` |
| Claim atomique des rappels | **PASS** | `updateMany({where: {id, statutEnvoi: "PLANIFIE"}, data: {statutEnvoi: "ENVOYE", ...}})` **avant** l'envoi réel de l'email (lignes 128–133) |
| Protection double-envoi sous exécutions concurrentes | **PASS, vérifié par test** | `revendication.count === 0` → `continue` sans ré-envoyer ; confirmé par test (§18 : exactement 2 `ENVOYE` après deux appels successifs, jamais plus) |
| Traitement des erreurs d'envoi | **PASS** | `succes === false` → statut `ECHEC`, jamais laissé en `ENVOYE` faussement |
| Cohérence des statuts après échec | **PASS** | Revérification `Interview`/`InterviewParticipant` au moment du traitement (lignes 114–126), `ANNULE` si Interview terminal ou participant `REFUSEE`, jamais un envoi orphelin |

**Note mineure (cosmétique, non bloquante)** : le commentaire de
`secretsEgaux()` (ligne 32 du fichier route) dit *"condensées en HMAC-SHA256"* —
le code réel utilise `crypto.createHash("sha256")`, un hash simple, **pas** un
HMAC (pas de clé). Le mécanisme reste cryptographiquement valide pour l'usage
visé (comparaison à temps constant de deux chaînes connues, pas une
vérification d'authenticité nécessitant une clé), mais le commentaire est
factuellement inexact. **Statut : finding cosmétique, sans impact sécurité.**

### 16.1 Disponibilité réelle d'un ordonnanceur en production — NON VÉRIFIABLE depuis cet environnement

**FAIT VÉRIFIÉ** : aucune configuration de cron (Vercel Cron ou autre) n'existe
dans ce dépôt (`grep` sur `vercel.json`, aucun fichier de ce nom trouvé à la
racine ; aucune définition de cron ailleurs dans le dépôt).

**NON VÉRIFIABLE** : l'état réel de l'environnement d'hébergement de production
(Vercel ou autre) n'est pas accessible depuis cette session — impossible de
confirmer ou d'infirmer si un cron y est réellement configuré. Le rapport
précédent affirme honnêtement l'absence de preuve plutôt que de supposer un
mécanisme automatique — **cette affirmation de prudence est confirmée correcte
par cet audit** : aucune preuve de configuration réelle n'existe nulle part dans
le dépôt lui-même, donc à défaut d'une confirmation externe, les rappels
**doivent être considérés comme non automatiques en production** à ce jour.

**Statut §16 : PASS** sur le code (sécurité, idempotence, concurrence,
isolation des échecs) ; **NON VÉRIFIABLE mais correctement documenté comme tel**
sur la disponibilité réelle du déclencheur périodique.

## 17. Audit métier (`journaliser()`)

**FAIT VÉRIFIÉ** par grep exhaustif sur toutes les routes du lot : les 10
actions attendues sont bien présentes et utilisées aux points corrects —
`candidate.selection.created`, `candidate.selection.cancelled`,
`interview.created`, `interview.invited`, `interview.rescheduled`,
`interview.cancelled`, `interview.accepted`, `interview.declined`,
`interview.evaluated`, `candidate.final_decision.recorded`. Aucun nouveau
système d'audit créé (`journaliser()` réutilisé tel quel partout). Les champs
`cible`/`detail` ne contiennent jamais de valeur personnelle (vérifié par grep,
§4/§12.2) — uniquement des identifiants techniques et des champs métier
non-sensibles (motif d'annulation, canal hors système).

Une imprécision relevée : `app/api/interviews/.../reponse/route.ts` mappe
`InterviewParticipantRole` vers le vocabulaire `acteurRole` de
`JournalActivite` (`ADMIN|INGENIEUR|CLIENT`) via une table de correspondance
explicite (`CANDIDAT→INGENIEUR`, `INTERVIEWEUR_INTERNE→INGENIEUR`,
`ADMIN_RECRUTEUR→ADMIN`, `CLIENT→CLIENT`) — un choix raisonnable et documenté
dans le code (cette route n'a aucune session pour connaître le rôle réel de
l'appelant), mais qui peut produire une ligne d'audit attribuant `acteurRole:
INGENIEUR` à un email qui n'est peut-être pas un compte `User` réel du tout (un
candidat externe sans compte ATLAS). **Statut : finding mineur, cosmétique sur
la précision du journal, sans impact sur la sécurité ou l'intégrité métier**
(le champ `acteurEmail` reste correct et c'est la donnée qui compte pour la
traçabilité réelle).

**Statut §17 : PASS**, avec une observation mineure non bloquante.

## 18. Couverture réelle des tests

**FAIT VÉRIFIÉ par exécution indépendante**, serveur `next start` démarré à
partir du build déjà présent (`.next/`, non reconstruit pendant cet audit pour
éviter toute réécriture de `tsconfig.json`) :

```
BASE_URL=http://localhost:3000 SESSION_SECRET=<...> \
INTERVIEW_REMINDER_INTERNAL_SECRET=<...> \
npx playwright test tests/api/candidate-decision-interview.spec.ts --project=chromium --no-deps

→ 18 passed (4.7s)
```

Ré-exécuté une seconde fois indépendamment → résultat identique, 18/18.

Correspondance avec la liste de règles critiques exigée par ce mandat d'audit
(§10) :

| Invariant critique | Testé ? | Commentaire |
|---|---|---|
| Décision Client-only | **Oui** | "le Client peut décider seul ; un Admin SANS communiqueParClientHorsSysteme est rejeté ; avec le flag, c'est accepté" |
| Interdiction décision Admin directe | **Oui** | même test, assertion 400 sur l'Admin sans flag |
| Accès cross-tenant | **Oui** | describe "RBAC / IDOR", Client A / Client B |
| IDOR | **Oui** | jeton croisé (403), `selectionId` inexistant (404), `profilId` jamais accepté |
| Immutabilité des évaluations | **Oui** | append-only vérifié en base (2 lignes, `supersedesId` chaîné) |
| Transitions d'entretien | **Oui, mais incomplet** | CONFIRME et refus→ANNULE testés **séquentiellement uniquement** — voir §8.1, la concurrence réelle n'est jamais testée |
| Concurrence | **PARTIEL** | testée pour l'endpoint de rappels (claim atomique) ; **jamais testée** pour la transition CONFIRME (§8.1) ni pour la création de sélection/décision (bien que le code soit `Serializable`+retry, aucun test ne force réellement deux transactions concurrentes) |
| Rappel idempotent | **Oui** | deux appels à `traiterRappelsDus()`, exactement 2 `ENVOYE`, jamais retraité |
| Fuite d'identité | **Oui, mais incomplet** | identité nom/prénom testée ; **`score`/`confiance`/`motifs` jamais testés** — c'est précisément le trou qui laisse passer le finding §12.3 |
| Erreurs d'intégration | **Partiel** | email/calendrier non simulés en échec dans les tests dédiés (le mode placeholder de `lib/email.ts` retourne toujours `true`, donc le chemin `ECHEC` d'un rappel n'est jamais réellement exercé par un test, seulement par lecture de code) |

**Conclusion §18, conforme à l'avertissement du mandat** : "test vert" ≠ "règle
couverte" se vérifie concrètement ici — 18/18 vert ne garantit ni l'absence de
fuite `score`/`confiance`/`motifs` (§12.3, confirmé en fuite réelle malgré la
suite verte), ni la sûreté de `CONFIRME` sous concurrence réelle (§8.1).

**Statut §18 : PARTIAL.**

## 19. Analyse indépendante des deux échecs Lot 15.5

**Ré-exécution indépendante**, deux fois, résultats identiques et
reproductibles :

```
npx playwright test tests/api/talent-fondations.spec.ts \
  tests/api/lot15-5-client-requirement-builder.spec.ts --project=chromium --no-deps
→ 17 passed, 2 failed (constant sur 2 exécutions)
```

Échec 1 — "guidé → confirmation → matching → résultats anonymisés" (ligne 113) :
le test crée un profil `Playwright+TypeScript`, 6 ans d'expérience, et s'attend
à le retrouver dans le Top 5 d'un matching `skillsRequired: ["Playwright"]`. Le
**commentaire du test lui-même** (lignes 142–146) anticipe explicitement une
base partagée et cumulative, et vérifie donc la présence du profil plutôt que
son exclusivité — mais le profil n'apparaît **pas du tout** dans les résultats.

**FAIT VÉRIFIÉ par requête SQL non destructive** sur `atlas_ci` :

```sql
select count(*) from "Profil" where "cvValide" = true and 'Playwright' = ANY(competences);
→ 371
```

371 profils `cvValide: true` partagent déjà le tag "Playwright" dans cette base
cumulative — largement suffisant pour qu'au moins 5 d'entre eux surclassent le
profil fraîchement créé par le test sur les autres critères de
`classerAvecRequirement` (expérience, disponibilité, etc.), l'évinçant du Top 5
(`MAX_RESULTATS_BESOIN = 5`).

Échec 2 — "Test 5 — RequirementStructure valide..." (ligne 359) : le
**commentaire du test lui-même** (lignes 362–366) choisit délibérément
"Cypress" plutôt que "Playwright" **précisément pour éviter ce problème déjà
connu**. Vérification :

```sql
select count(*) from "Profil" where "cvValide" = true and 'Cypress' = ANY(competences);
→ 27
```

27 profils existants partagent déjà "Cypress" — suffisant, au vu du même
mécanisme, pour évincer également ce second fixture du Top 5.

**Élimination explicite de la responsabilité du lot audité** : la fonction
`creerProfilCandidat()` du fichier de test de ce lot
(`tests/api/candidate-decision-interview.spec.ts`) crée des `Profil` **sans
aucune compétence** (`competences` non renseigné → défaut `@default([])` du
schéma, vérifié) — ils ne peuvent structurellement pas apparaître dans ce
comptage ni influencer ces deux tests. Le lot audité ne touche jamais
`Profil.competences`, `lib/talent/matching.ts`, ni `classerAvecRequirement`
(confirmé par l'inventaire §4 : zéro fichier de ce domaine modifié).

**Conclusion** : les deux échecs sont **indépendamment confirmés** comme une
fragilité préexistante et déjà documentée par les auteurs du test eux-mêmes
(avant ce lot), causée par l'accumulation de fixtures `Profil` sur une base de
test partagée et jamais réinitialisée au fil de très nombreux lots antérieurs —
**pas une régression causée par le lot Candidate Decision + Interview**.
Reproductible, stable, cause racine identifiée avec des comptes SQL précis
(pas une hypothèse non vérifiée).

**Statut §19 : NON-RÉGRESSION CONFIRMÉE INDÉPENDAMMENT — pré-existant, non
bloquant pour ce lot.** Aucun nettoyage de base n'a été exécuté pour obtenir ce
résultat (interdit par le mandat) ; la preuve repose uniquement sur des
requêtes `SELECT` et la lecture du code.

## 20. TypeScript et build

```
npx tsc --noEmit -p tsconfig.json → EXIT 0, aucune sortie (vérifié indépendamment)
```

**Build** : le build de la session d'implémentation précédente (`.next/`) a été
réutilisé **sans reconstruction** pendant cet audit, précisément pour éviter de
rejouer la réécriture connue de `tsconfig.json` par `next build`. `tsconfig.json`
n'apparaît dans aucun diff à l'ouverture ni à la clôture de cet audit — confirmé
intact. Le serveur `next start` démarré depuis ce build existant a servi
correctement toutes les routes testées (§18), ce qui constitue une preuve
indirecte mais réelle que le build précédent était fonctionnel pour ce code.

**Statut §20 : PASS** (vérifié sans risque de répéter la modification de
`tsconfig.json`).

## 21. Déviations contractuelles

Récapitulatif des déviations identifiées par cet audit, qu'elles aient ou non
été reconnues par le rapport précédent :

1. **Reconnue par le rapport précédent, confirmée par cet audit** : le DTO
   `CandidatAnonyme` à 9 champs n'est pas reproduit tel quel sur la route
   shortlist Client (projection réelle `score`/`confiance`/`motifs` à la place)
   — **mais cette déviation elle-même masque la violation plus grave de §12.3**,
   que le rapport précédent n'a pas identifiée comme une violation distincte et
   non négociable.
2. **Non reconnue par le rapport précédent, confirmée par cet audit (§12.3)** :
   exposition de `score`/`confiance`/`motifs` au Client, violant la CTO
   Validation §5/§21.3 de façon non ambiguë.
3. **Non reconnue par le rapport précédent, confirmée par cet audit (§14.1)** :
   câblage reschedule/annulation calendrier absent de `lib/interview/service.ts`.
4. **Non reconnue par le rapport précédent, confirmée par cet audit (§8.1)** :
   fenêtre de concurrence non protégée sur la transition `CONFIRME`.
5. **Non reconnue par le rapport précédent, confirmée par cet audit (§4.2)** :
   attribution mixte de `lib/email.ts` (une partie du diff appartient à un lot
   antérieur, Engineer Access & Trust).
6. **Extension de périmètre non listée explicitement dans la table API §15 du
   contrat** (§4.4) : `GET /api/talent/demandes/[id]/selections`, justifiée par
   une règle de visibilité réelle mais absente de la liste contractuelle
   explicite des routes.

## 22. Risques bloquants

- **§12.3 — fuite `score`/`confiance`/`motifs` vers le Client.** Violation
  confirmée d'une condition CTO explicitement qualifiée de non négociable et de
  prérequis au merge. C'est, par construction du mandat CTO lui-même, le seul
  finding de cet audit qui franchit le seuil d'un "risque majeur" au sens de ce
  mandat — mais la correction est précise, bornée, et ne remet pas en cause le
  reste de l'architecture (voir §23 pour le raisonnement sur le choix du
  verdict).

## 23. Risques non bloquants

- **§8.1** — fenêtre de concurrence sur `CONFIRME` (sévérité moyenne, auto-
  réparable dans la plupart des cas réels, aucune preuve d'occurrence réelle).
- **§14.1** — câblage calendrier reschedule/annulation manquant (impact nul
  aujourd'hui, provider toujours absent ; latent pour une intégration future).
- **§16, note mineure** — commentaire inexact "HMAC" vs hash simple (cosmétique).
- **§17, observation mineure** — mapping `acteurRole` approximatif sur la route
  à jeton (cosmétique, traçabilité réelle préservée via `acteurEmail`).
- **§4.2/§4.4** — imprécisions d'attribution du rapport précédent (lib/email.ts
  mixte, route selections hors liste contractuelle explicite) — sans impact
  technique, mais à corriger dans la documentation du lot.

## 24. Prérequis de production

Confirmés par cet audit, identiques à ce que le rapport précédent affirme sur ce
point précis (§16.1) :

1. `INTERVIEW_REMINDER_INTERNAL_SECRET` doit être positionnée dans
   l'environnement d'hébergement réel — **NON VÉRIFIABLE** depuis cet
   environnement si c'est déjà fait ou non en production réelle ; confirmé
   absent de ce dépôt et de cet environnement de test.
2. Un cron externe réel doit appeler périodiquement
   `POST /api/internal/interview-reminders/process` — **confirmé absent de toute
   configuration présente dans ce dépôt** (aucun `vercel.json`, aucune
   définition de cron trouvée). Sans cela, aucun rappel n'est automatique en
   production, quel que soit le code.
3. (Non bloquant, hors scope) un provider calendrier réel, si une synchronisation
   visible est un jour souhaitée — le mécanisme de création est prêt, celui de
   reschedule/annulation ne l'est pas encore (§14.1).

## 25. Fichiers hors scope ou attribution incertaine

Voir §4.3 (fichiers explicitement non attribuables, appartenant à des lots
antérieurs non committés — aucun n'a été inspecté en détail par cet audit car
hors mandat) et §4.4 (route `selections` hors liste contractuelle explicite,
mais justifiée par une règle réelle).

Aucune dépendance interdite introduite — **FAIT VÉRIFIÉ** par l'inventaire §4 et
par lecture des imports de chaque fichier neuf : zéro import depuis
`lib/talent/matching.ts` (hors lecture des champs déjà stockés), zéro import
Mission/MissionAssignment/Proposal, zéro provider IA/LLM, zéro fichier touché
sous `lib/mission/*`, `lib/outcome/*`, `lib/decision-context/*`,
`lib/agentic/*` (zones portant les invariants A18/A19 cités par le mandat).

## 26. Commit et push

**FAIT VÉRIFIÉ** : aucun commit créé, aucun push effectué pendant cet audit.
`git rev-parse HEAD` identique avant/après (§1, §15).

## 27. Verdict final

### B — ACCEPTED WITH REQUIRED FIXES

**Raisonnement, explicite sur le choix entre B et C** : l'architecture dans son
ensemble est solide et correctement vérifiée — migration additive propre,
invariants Serializable+retry corrects pour la sélection et la décision finale,
RBAC/tenant/IDOR corrects et testés, et surtout l'invariant le plus critique du
mandat (**autorité exclusive du Client sur la décision finale, Admin jamais
autonome**) est implémenté avec un double verrouillage service+route et
explicitement testé (§10). Les deux non-régressions Lot 15.5 sont confirmées
indépendamment comme préexistantes et sans lien avec ce lot (§19).

Mais un finding franchit le seuil d'un "contrat violé" au sens strict du mandat
d'audit (§12.3) : l'exposition de `score`/`confiance`/`motifs` au Client,
visible jusque dans l'UI, contredit une condition que la CTO Validation
qualifie elle-même, en toutes lettres, de non négociable et de prérequis au
merge — et pour laquelle le test de non-fuite explicitement exigé n'a jamais
été écrit. Ce n'est pas un détail cosmétique : c'est précisément le type de
"dérive silencieuse" que ce programme ATLAS interdit par principe depuis son
premier mandat.

Ce finding, ainsi que les deux findings de sévérité moyenne (§8.1 concurrence
CONFIRME, §14.1 câblage calendrier manquant), sont cependant **précis, bornés,
et ne remettent pas en cause la conception retenue** — ils se corrigent sans
redesign : retirer 3 champs de 2 réponses JSON + 1 ligne d'UI et ajouter le test
manquant (§12.3) ; ajouter `Serializable`+retry ou une relecture post-commit sur
une seule fonction (§8.1) ; ajouter deux appels dans deux fonctions existantes
(§14.1). Aucun de ces trois correctifs ne nécessite de revoir le schéma, les
contrats métier, ou l'architecture des 7 objets, qui restent, eux, validés sans
réserve par cet audit.

**Corrections requises avant acceptation définitive (non exécutées par cet
audit, à faire dans un lot de correction dédié)** :

1. Retirer `score`/`confiance`/`motifs` de
   `GET /api/client/talent-selection/demandes/[demandeId]/shortlist` et de
   `GET /api/client/talent-selection/demandes/[demandeId]/comparison`, et de
   l'affichage correspondant dans `SelectionEtEntretiens.tsx`. Ajouter le test
   de non-fuite explicitement exigé par la CTO Validation §5.
2. Protéger `enregistrerReponseInvitation` contre la fenêtre de concurrence
   identifiée en §8.1 (Serializable+retry, ou relecture post-commit), et ajouter
   un test de concurrence réelle.
3. Câbler `resynchroniserApresReprogrammation`/`annulerSync` dans
   `lib/interview/service.ts` (reschedule/annulation), ou documenter
   explicitement cette limitation dans le rapport d'implémentation si la
   correction est différée.

Les findings mineurs (§16 note HMAC, §17 mapping acteurRole, §4.2/§4.4
attribution) n'empêchent pas l'acceptation mais doivent être corrigés dans la
documentation du lot.

---

## 15 (bis). Git final — vérification de clôture

```
git status --short | wc -l   → 88 (identique à l'ouverture, §2)
git rev-parse HEAD            → 265f0a8be2a6d162fbaa911293ccad3691f3a58e (inchangé)
git diff --check              → (vide, aucune erreur)
```

Seul ajout de cette session d'audit : le présent fichier
(`docs/audits/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_AUDIT.md`). Aucun
fichier préexistant écrasé. Artefacts protégés (`next-env.d.ts`,
`package-lock.json`, `tsconfig.tsbuildinfo`) non suivis, non modifiés, non
restaurés.

---

**CANDIDATE DECISION + INTERVIEW — INDEPENDENT AUDIT COMPLETE**
**VERDICT : B — ACCEPTED WITH REQUIRED FIXES**

Après ce document : STOP. Aucune correction appliquée. Aucun commit. Aucun
push. Aucun lot suivant commencé.
