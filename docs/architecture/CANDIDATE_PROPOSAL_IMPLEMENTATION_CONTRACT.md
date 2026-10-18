# ATLAS — CANDIDATE PROPOSAL IMPLEMENTATION CONTRACT

Document de conception uniquement. Aucun fichier applicatif, schéma Prisma,
migration, route, UI, test, configuration, dépendance ou donnée n'a été créé
ou modifié pour produire ce contrat. Toutes les affirmations ci-dessous sont
vérifiées directement dans le code réel du dépôt (`atlas-admin-demo`),
jamais supposées — aucun nom de fonction, de champ ou de route n'est copié
sans avoir été lu dans le fichier source cité.

Ce contrat est **strictement conforme** au
`docs/architecture/CANDIDATE_PROPOSAL_DESIGN_CONTRACT.md` (verdict :
**DESIGN LOCKED — READY FOR IMPLEMENTATION CONTRACT**, revues A35/A35.1). Il
ne rouvre aucune décision déjà `LOCKED` — il les traduit en algorithmes,
modèle conceptuel, routes et tests suffisamment précis pour qu'aucune
décision architecturale ne soit prise silencieusement pendant
l'implémentation réelle.

---

## 1. Références et invariants verrouillés

### 1.1 Document de référence

`docs/architecture/CANDIDATE_PROPOSAL_DESIGN_CONTRACT.md`, revues A35
(§15, D1-D5) et A35.1 (mêmes décisions, complétées). Verdict :
**DESIGN LOCKED — READY FOR IMPLEMENTATION CONTRACT**.

### 1.2 Les 19 invariants verrouillés, repris sans modification

Chaque invariant cite sa source exacte dans le Design Contract ou dans le
code réel — aucun n'est réinterprété.

| # | Invariant | Source |
|---|---|---|
| 1 | Une `CandidateProposal` concerne une entrée `RETENU` d'une `CandidateFinalDecision` | Design Contract §3, §5.1 |
| 2 | L'identité de la proposition est stable | Design Contract §11.2 (D2 : l'id de la `CandidateProposal` elle-même) |
| 3 | Une proposition acceptée (`ACCEPTEE`) est terminale et immuable | Design Contract §7.4 (D1) |
| 4 | L'acceptation ATLAS ne constitue pas, à elle seule, une preuve de signature juridiquement valable | Design Contract §12 (D5) |
| 5 | La décision finale du candidat appartient exclusivement au Client | CTO Validation §13, repris Design Contract §8.1 |
| 6 | L'Admin ne peut qu'enregistrer une décision communiquée hors système | Design Contract §8.2, mirroring `CandidateFinalDecision` |
| 7 | Une décision source supersédée interdit l'acceptation et la création d'une proposition successeur | Design Contract §10.5 (D4), règles 3-4 |
| 8 | La vérification de fraîcheur de la décision source doit être atomique avec l'opération métier correspondante | Design Contract §10.5 |
| 9 | L'expiration et le remplacement sont dérivés, jamais stockés comme états persistés | Design Contract §7.2 |
| 10 | Aucune donnée historique ou commerciale n'est inventée | Design Contract §6, mandat §5 |
| 11 | Le snapshot commercial émis est figé | Design Contract §6.2, §7.2 (état `EMISE`) |
| 12 | Les opérations humaines sont auditées avec `journaliser()` | Design Contract §9 ; `lib/audit.ts` (vérifié §2.3 ci-dessous) |
| 13 | Les effets externes ne sont jamais exécutés à l'intérieur d'une transaction métier | Design Contract §12, §13 risque 10 |
| 14 | La création de Mission est idempotente | Design Contract §11.2, §11.4 |
| 15 | Une même `CandidateProposal` acceptée ne peut produire qu'une seule `Mission` | Design Contract §11.2 (D2) |
| 16 | Une `Mission` existante sans provenance n'est jamais associée automatiquement par heuristique | Design Contract §11.2 (D2) |
| 17 | `Mission.needVersionId`/`solutionDecisionId` restent `null` pour la portée minimale, jamais déduits | Design Contract §11.3 (D3) |
| 18 | `Mission.profilId` reste soumis à ses invariants existants (non nullable) | Design Contract §2.3, vérifié `prisma/schema.prisma:1245-1246` |
| 19 | Aucun couplage nouveau à `WorkItem`, `Delivery`, Capability Engine, Agentic Runtime, Learning Loop | Design Contract §16, §11.5 |

Aucun de ces invariants n'est modifié par ce contrat. Ce document ne fait
que les opérationnaliser.

---

## 2. État réel du dépôt (vérifié pour ce contrat)

Chaque fait ci-dessous a été relu directement dans le code réel au moment
de la rédaction de ce contrat (pas seulement cité depuis le Design
Contract).

### 2.1 `CandidateFinalDecision` / `CandidateFinalDecisionEntree`

`prisma/schema.prisma:233-260` (vérifié identique à la citation du Design
Contract §2.2). `lib/candidate-decision/final-decision.ts` (relu
intégralement) :
- `creerCandidateFinalDecision(tx, params)` : relit `tx.candidateFinalDecision.findFirst({ where: { demandeTalentId, supersededBy: null } })` avant de créer — refuse (`DecisionActiveExistanteError`) si `params.supersedesId` ne correspond pas à la décision active réelle, refuse (`SupersedesIntrouvableError`) si `supersedesId` est fourni sans décision active.
- `creerCandidateFinalDecisionAvecRetry(params)` : boucle `MAX_TENTATIVES = 3`, `prisma.$transaction(tx => ..., { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`, retry sur `erreur.code === "P2034"`, sinon relance (y compris `P2002` → `DejaSupersedeError`).
- `lireCandidateFinalDecisionActive(demandeTalentId)` : lecture seule, `findFirst({ where: { demandeTalentId, supersededBy: null } })` — **fonction directement réutilisable** pour la vérification de fraîcheur D4.

### 2.2 Routes de décision finale (précédent direct pour l'API de ce contrat)

Relues intégralement :
- `app/api/client/talent-selection/demandes/[demandeId]/final-decision/route.ts` (Client) : `GET`/`POST`, guard `session.role !== "CLIENT" || !session.clientId` → 403 ; tenant scoping via `demandeTalent.findFirst({ where: { id, clientId: session.clientId } })` → 404 si absent ; `decideParRole` toujours forcé à `"CLIENT"`, jamais lu du body ; mapping d'erreurs métier → HTTP (404/400/409) par instance de classe d'erreur.
- `app/api/talent/demandes/[id]/final-decision/route.ts` (Admin) : même structure, guard `session.role !== "ADMIN"` → 403 ; schéma Zod étendu (`corpsAdminSchema`) forçant `communiqueParClientHorsSysteme: z.literal(true)` + `canalHorsSysteme` non vide — **jamais une décision Admin autonome, revérifiée par le service en plus de la route**.

Ces deux routes sont le **patron exact** réutilisé pour les routes de ce
contrat (§10).

### 2.3 `journaliser()` (`lib/audit.ts`, relu intégralement)

Signature : `journaliser({ acteurEmail, acteurRole: "ADMIN"|"INGENIEUR"|"CLIENT", action, cible?, detail?, correlationId? })`. Écrit `prisma.journalActivite.create(...)`, **best-effort** (`try/catch` + `console.error`, ne relance jamais). Utilisé dans les deux routes ci-dessus avec `action: "candidate.final_decision.recorded"`, `cible: "demande:... decision:..."`.

### 2.4 `Mission` et `lib/mission/need-pinning.ts`

`prisma/schema.prisma:1240-1389` (relu intégralement) :
- `profilId String` (non nullable), `clientId String` (non nullable), `sourceDemandeId String?` (nullable, **indexé mais pas `@unique`** — commentaire du schéma confirme explicitement qu'une même `DemandeTalent` peut produire plusieurs `Mission`).
- `needVersionId String?` / `solutionDecisionId String?` — additifs A18, immuables une fois posés (contrôlé service).
- **Aucun champ `sourceCandidateProposalId` n'existe** — confirmé par lecture complète.
- **Compatibilité d'un futur champ vérifiée** : ajouter `sourceCandidateProposalId String? @unique` ne heurte aucun champ, aucune contrainte, aucun index existant du modèle `Mission` — strictement additif, même nature que `needVersionId`/`solutionDecisionId` (A18) déjà ajoutés sans incident. **Aucune incompatibilité réelle trouvée — ce point n'est donc jamais bloquant pour ce contrat.**

`lib/mission/need-pinning.ts::validerPinsMission(db, params)` (relu
intégralement) : `needVersionId` et `solutionDecisionId` sont vérifiés et
acceptés **indépendamment** l'un de l'autre (la cohérence croisée ne
s'applique que si les deux sont fournis) — confirme que laisser les deux à
`null` (invariant 17) ne requiert et ne modifie rien dans cette fonction.

### 2.5 Pattern transactionnel « conditional update + count » (précédent distinct de Serializable+retry)

`lib/interview/reminders.ts` (relu, cité Design Contract §10.2) : la
« revendication » d'une ligne se fait par un `updateMany({ where: { id,
statutEnvoi: "PLANIFIE" }, data: {...} })` suivi d'une vérification du
nombre de lignes affectées — **pattern distinct** de Serializable+retry
(qui protège un *ensemble* de lignes lu avant décision), utilisé ici pour
protéger une transition d'état *individuelle* avec une sémantique
idempotent/conflit propre. Les deux mécanismes sont **complémentaires**,
pas substituables (détail §6.2).

### 2.6 Middleware — aucune modification requise

`middleware.ts` (relu, `config.matcher`) : `/api/client/:path*` et
`/api/talent/:path*` sont **déjà** dans le matcher protégé ; `CLIENT_PREFIXES`
inclut `"/api/client/"` (déjà couvre `/api/client/talent-selection/...`,
précédent du lot Candidate Decision + Interview). Les futures routes de ce
contrat (§10), situées sous ces deux préfixes, **n'exigent aucune
modification de `middleware.ts`** — chaque route s'auto-garde (même
discipline que §2.2), le middleware ne fait que restreindre l'espace
(ADMIN/CLIENT/INGENIEUR), jamais la décision RBAC fine.

### 2.7 `lib/url-signee.ts` (précédent pour `EXPIREE` dérivée)

`creerUrlSignee`/`verifierUrlSignee` : expiration encodée et vérifiée **au
moment de l'usage**, aucune écriture d'un état "expiré", aucun scheduler —
précédent direct pour le calcul de `EXPIREE` (§5.5, §6).

---

## 3. Modèle conceptuel

**Aucun bloc `model CandidateProposal { ... }` Prisma n'est écrit ici** —
conformément au mandat. Le tableau ci-dessous décrit les champs
conceptuels, leur type, leur immutabilité et leur mutabilité par état ; la
traduction en schéma Prisma réel est un acte du contrat d'implémentation
technique (hors périmètre documentaire de ce contrat).

### 3.1 Parent et scoping

- **Parent métier** : exactement une `CandidateFinalDecisionEntree`
  (`candidateFinalDecisionEntreeId`), avec `statut = RETENU` au moment de
  la création (vérifié, jamais supposé — §5.1).
- **Dénormalisation justifiée** (même précédent que `SolutionOption.clientId`,
  Design Contract §2.4/§5.1) : `demandeTalentId` et `clientId` sont
  dénormalisés sur `CandidateProposal` pour permettre une vérification
  d'ownership en une seule lecture côté Client, sans remonter la chaîne
  `Entree → CandidateFinalDecision → DemandeTalent → Client` à chaque
  requête — cohérent avec le dépôt, pas une nouvelle convention.

### 3.2 Champs conceptuels

| Champ | Type | Immutabilité | Mutable dans |
|---|---|---|---|
| `id` | identifiant (cuid) | Immuable | — |
| `candidateFinalDecisionEntreeId` | référence (jamais copiée) | Immuable dès la création | — |
| `demandeTalentId` | référence dénormalisée | Immuable | — |
| `clientId` | référence dénormalisée | Immuable | — |
| `statut` | enum (§5) | Transition contrôlée (§5.2) | selon transitions autorisées |
| `supersedesId` | référence nullable, unique | Immuable dès la création | — (jamais réécrit) |
| **Snapshot commercial** (ex. TJM proposé, devise, durée, date de début envisagée — **noms de champs et valeurs à fixer par le contrat de schéma réel, aucun n'est fixé ici**, conforme Design Contract §6.2) | selon le champ | Figé dès `EMISE` | `BROUILLON` uniquement |
| `dateValidite` | date nullable | Figée dès `EMISE` | `BROUILLON` uniquement |
| `emisLe` | date nullable | Posée une fois, jamais réécrite | — (posée à la transition `EMISE`) |
| `emisParEmail` | string nullable **(ajouté A35.4/F6)** | Posée une fois, jamais réécrite | — (posée à la transition `EMISE`, acteur authentifié ayant exécuté l'émission) |
| `decideLe` | date nullable | Posée une fois | — (posée à `ACCEPTEE`/`REFUSEE`) |
| `retireeLe` | date nullable | Posée une fois | — (posée à `RETIREE`) |
| `decideParEmail` | string nullable | Posée une fois | — |
| `communiqueParClientHorsSysteme` | boolean, `@default(false)` | Posée une fois | — (même nom que `CandidateFinalDecision`, §8.2) |
| `canalHorsSysteme` | string nullable | Posée une fois | — |
| `createdByEmail` | string (Admin créateur) | Immuable | — |
| `createdAt`/`updatedAt` | horodatage standard | — | — |

**Aucun montant, taux ou condition commerciale n'est fixé par ce
contrat** — le jeu exact de champs du snapshot commercial (ligne
« Snapshot commercial » ci-dessus) est délibérément laissé générique :
c'est un détail du contrat de schéma réel, jamais une donnée métier
inventée ici.

**Précision A35.4/F6 — `emisParEmail`** : ce champ capture l'acteur qui a
**exécuté** la transition `BROUILLON → EMISE` (§6.2), distinct de
`createdByEmail` (qui a créé le `BROUILLON`, potentiellement un autre
Admin) et de `decideParEmail` (qui a accepté/refusé, côté Client ou Admin
hors-système). Les trois champs coexistent sans se dériver l'un de
l'autre — **aucun n'est jamais déduit d'un autre**, chacun est posé
exactement une fois, au moment de l'acte qu'il décrit. Pour les futures
lignes historiques créées sous ce contrat, `emisParEmail` est renseigné
avec l'identité de session réelle à l'émission ; **aucune identité n'est
jamais fabriquée** rétroactivement pour une ligne où cette information
n'aurait pas été capturée. `journaliser()` (§9) reste cohérent avec ces
trois champs : l'action `candidate.proposal.emitted` porte `acteurEmail =
emisParEmail`, jamais `createdByEmail`.

### 3.3 Invariants d'unicité

- **`@@unique([supersedesId])`** — au plus un successeur par proposition
  (même pattern que `CandidateFinalDecision.supersedesId`,
  `ShortlistEntree`) : garantie **en base**.
- **« Au plus une `CandidateProposal` active
  (`BROUILLON`/`EMISE`/`ACCEPTEE`) par `candidateFinalDecisionEntreeId` »**
  — vérifiée **transactionnellement** (Serializable+retry, §6.1), **pas**
  par une contrainte DB — même choix que l'invariant analogue déjà en
  place pour `CandidateFinalDecision` (« au plus une active par
  `demandeTalentId` », vérifié en code, §2.1). Un index unique partiel
  (`WHERE statut IN (...)`) serait techniquement possible sous Postgres,
  mais **aucun précédent de ce type n'existe dans le dépôt** — rester sur
  le mécanisme transactionnel déjà prouvé est cohérent avec le mandat
  Design Contract §6.4 ("ne choisis pas automatiquement une nouvelle
  structure si un mécanisme existant peut répondre au besoin"). Marqué
  **IMPLEMENTATION DETAIL** : l'index partiel reste une optimisation
  future possible, jamais une obligation de ce contrat.
- **Précision A35.4/F1** : cette unicité est toujours évaluée pour
  l'entrée **cible** effectivement référencée par la proposition en cours
  de création — jamais pour une entrée prédécesseur devenue obsolète
  après une supersession de décision (§6.1.d). Comme une entrée donnée
  n'appartient qu'à une seule `CandidateFinalDecision`, et qu'au plus une
  décision est active à la fois pour une `DemandeTalent`, cette garantie
  reste équivalente à "au plus une proposition active par candidat
  (`candidateSelectionId`) au sein de la décision active courante" — sans
  modification du mécanisme lui-même.

### 3.4 Relations conceptuelles (reprise du Design Contract §5.2, inchangée)

```
DemandeTalent (existant)
    └── CandidateFinalDecision (existant, append-only)
            └── CandidateFinalDecisionEntree (existant, statut RETENU/NON_RETENU)
                    └── CandidateProposal (NOUVEAU, conceptuel) [0..N dans le temps, 1 active]
                            ├── supersedesId → CandidateProposal (append-only)
                            └── [hors création dans ce contrat] Mission.sourceCandidateProposalId (futur, additif)
```

---

## 4. Snapshot et immutabilité

Reprise opérationnelle du Design Contract §6, sans modification.

### 4.1 Référencé, jamais copié

Identique à Design Contract §6.1 : identité du candidat (via la chaîne
`candidateFinalDecisionEntreeId → candidateSelectionId → shortlistEntree.profilId`,
jamais copiée), contexte de la demande (`demandeTalentId`, jamais une
copie des critères), client (`clientId`).

### 4.2 Figé à l'émission, avec mécanisme de gel explicite

**Mécanisme de gel** : au niveau service (jamais en DB — Postgres ne
permet pas une contrainte "ce champ devient immuable une fois `statut =
EMISE`"), toute tentative de mutation des champs du snapshot commercial ou
de `dateValidite` sur une `CandidateProposal` dont `statut !== "BROUILLON"`
est un refus explicite (nouvelle classe d'erreur dédiée, ex.
`ProposalNonModifiableError`) — jamais une mutation silencieusement
ignorée, jamais une exception générique non distinguée.

### 4.3 Jamais copié

Identique à Design Contract §6.3 : aucune compétence, aucun critère de
matching, aucun score, aucune disponibilité courante — tout est lu par
référence si besoin d'affichage, jamais stocké.

---

## 5. Cycle de vie

Reprise exacte du Design Contract §7 (5 états persistés, 2 dérivés),
opérationnalisée.

### 5.1 États persistés

`BROUILLON`, `EMISE`, `ACCEPTEE`, `REFUSEE`, `RETIREE` — justification
individuelle inchangée, voir Design Contract §7.2.

### 5.2 États dérivés (jamais stockés)

- **`EXPIREE`** : fonction pure `calculerStatutEffectif(proposal, maintenant)` → retourne `"EXPIREE"` si `proposal.statut === "EMISE"` ET `proposal.dateValidite !== null` ET `maintenant > proposal.dateValidite`, sinon retourne `proposal.statut` tel quel. Aucune écriture, aucun scheduler (précédent `lib/url-signee.ts`, §2.7).
- **`REMPLACEE`** : jamais une valeur de `statut` — se lit par `supersededBy !== null` (relation inverse de `supersedesId`), même précédent que `CandidateFinalDecision`/`ShortlistEntree`.

### 5.3 Table des transitions autorisées (reprise exacte, Design Contract §7.3)

| Depuis | Vers | Acteur | Garde |
|---|---|---|---|
| *(aucun)* | `BROUILLON` | ADMIN | Référence à une `CandidateFinalDecisionEntree` `RETENU`, active (§6.1) |
| `BROUILLON` | `EMISE` | ADMIN | Snapshot commercial complet ; re-vérification de fraîcheur de la décision source (§6.1) |
| `BROUILLON` | `RETIREE` | ADMIN | Toujours autorisé |
| `EMISE` | `ACCEPTEE` | CLIENT (ou ADMIN hors-système, §8.2) | `maintenant <= dateValidite` (si définie) ; fraîcheur de la décision source (§6.2) |
| `EMISE` | `REFUSEE` | CLIENT (ou ADMIN hors-système) | idem |
| `EMISE` | `RETIREE` | ADMIN | Toujours autorisé avant toute réponse Client |
| `ACCEPTEE` | *(aucune)* | — | Terminal (invariant 3) |
| `REFUSEE` | *(aucune directe)* | ADMIN | Seulement un successeur via `supersedesId` (§6.3) |
| `RETIREE` | *(idem)* | ADMIN | idem |

Toute transition hors de cette table est un refus explicite (409/400
selon convention existante) — jamais une correction silencieuse.

---

## 6. Algorithmes transactionnels

Chaque algorithme ci-dessous précise : le contrôle RBAC/tenant, l'isolation,
le retry, les gardes métier, et le point exact où les effets externes
(audit, email) s'exécutent — toujours **après** commit, jamais à
l'intérieur de la transaction (invariant 13).

### 6.1 Création d'un `BROUILLON` (avec ou sans `supersedesId`)

1. **RBAC** (route, avant toute lecture DB) : `session.role !== "ADMIN"` → 403.
2. **Résolution tenant** : `demandeTalentId`/`clientId` sont **toujours
   dérivés serveur** depuis la `CandidateFinalDecisionEntree` référencée
   (jamais acceptés depuis le body — même discipline LOT 6 déjà appliquée
   à `Mission.clientId` depuis `sourceDemandeId`, §2.2).
3. **Transaction** `Prisma.TransactionIsolationLevel.Serializable`,
   boucle `MAX_TENTATIVES = 3`, retry sur `P2034` :
   a. Relire la `CandidateFinalDecisionEntree` cible + sa
      `CandidateFinalDecision` parente. Si introuvable ou tenant différent
      → erreur dédiée (404, jamais une distinction révélant un autre
      tenant).
   b. Si `entree.statut !== "RETENU"` → refus explicite (nouvelle classe
      d'erreur, ex. `EntreeNonRetenueError`, 400).
   c. Si `decision.supersededBy !== null` (décision non active) → refus
      explicite (ex. `DecisionSourceNonActiveError`, 409) — **réutilise la
      même requête** que `lireCandidateFinalDecisionActive()` (§2.1),
      jamais une nouvelle logique de fraîcheur.
   d. **Si `supersedesId` est fourni (création d'un successeur) — corrigé A35.4/F1** :
      - i. Charger la proposition prédécesseur (désignée par
        `supersedesId`) et son entrée associée, pour en lire le
        `candidateSelectionId` d'origine.
      - ii. **Le successeur doit porter, pour sa propre
        `candidateFinalDecisionEntreeId`, une entrée dont le
        `candidateSelectionId` est identique à celui du prédécesseur —
        jamais un candidat différent** (garde anti-changement-de-candidat
        silencieux dans une chaîne de succession). **L'`id` de cette
        entrée peut être différent de celui du prédécesseur** : vérifié
        directement dans `lib/candidate-decision/final-decision.ts` et
        `prisma/schema.prisma` (`CandidateFinalDecisionEntree.@@unique([decisionId,
        candidateSelectionId])`) — chaque nouvelle `CandidateFinalDecision`
        crée de **nouvelles** lignes `CandidateFinalDecisionEntree`, avec
        un nouvel `id`, même pour un candidat déjà `RETENU` précédemment.
        Exiger la même `candidateFinalDecisionEntreeId` qu'au prédécesseur
        rendrait impossible toute succession après une supersession de la
        décision source, y compris lorsque le Client reconfirme le même
        candidat — ce que le Design Contract (§10.5, D4, règle 3) **n'exige
        jamais** : il exige seulement que l'entrée **cible** du successeur
        soit active et `RETENU`, jamais qu'elle coïncide avec celle du
        prédécesseur. Aucune divergence du Design Contract n'a donc été
        trouvée — seule la contrainte ajoutée par ce seul Implementation
        Contract est corrigée ici.
      - iii. Cette entrée cible (quel que soit son `id`) doit appartenir à
        la `CandidateFinalDecision` **active** (`supersededBy: null`) et
        porter `statut = RETENU` — **même vérification de fraîcheur qu'au
        point (c) ci-dessus, dans la même transaction Serializable+retry
        sur `P2034`**, jamais une logique de fraîcheur distincte.
      - iv. **État effectif du prédécesseur (corrigé A35.6/F1)** : la
        terminalité du prédécesseur doit être évaluée via son **état
        effectif** `calculerStatutEffectif(predecesseur, now())` (§5.2),
        **jamais** seulement le champ `statut` brut persisté. Les états
        effectifs autorisant la création d'un successeur sont exactement
        ceux déjà verrouillés comme terminaux non-`ACCEPTEE` par la table
        des transitions (§5.3) et par le Design Contract (§7.3/§10.5) :
        `REFUSEE`, `RETIREE`, et `EXPIREE` (dérivée). **Cas explicite** :
        un prédécesseur dont le `statut` stocké est encore `EMISE` mais
        dont `dateValidite` est dépassée a un état effectif `EXPIREE` —
        il doit être traité comme terminal au même titre qu'un
        `REFUSEE`/`RETIREE` stocké directement, et une création de
        successeur référençant une entrée `RETENU` d'une décision source
        active doit pouvoir réussir dans ce cas, sans qu'aucune règle de
        ce contrat ne la bloque à tort. `BROUILLON`/`EMISE` (effectif, non
        expiré)/`ACCEPTEE` restent interdits comme prédécesseur (invariant
        3+7). `REMPLACEE` (dérivée, `supersededBy !== null` **sur le
        prédécesseur lui-même**) n'est jamais un point de départ valide
        pour une seconde supersession : si le prédécesseur a déjà un
        successeur, toute seconde tentative de création avec le même
        `supersedesId` viole directement `@@unique([supersedesId])` (§3.3)
        — cette contrainte en base, et non une règle de statut
        supplémentaire, est la garantie pour ce cas, traitée par le refus
        explicite déjà prévu en fin de (d). Le Design Contract ne définit
        aucune autre liste d'états terminaux autorisant une succession que
        celle déjà verrouillée en §7.3/§10.5 — aucune n'est inventée ici.
      - v. Si le candidat n'est plus `RETENU` dans la décision active, ou
        si aucune décision active n'existe pour cette `DemandeTalent` :
        refus explicite (ex. `DecisionSourceNonActiveError`/
        `EntreeNonRetenueError`, 409) — jamais une création sur une base
        obsolète, jamais une tentative de retrouver une correspondance
        plausible par une autre voie.
      - vi. **Précision terminologique (corrigé A35.6/F1)** :
        `CandidateFinalDecisionEntree` ne porte **aucun champ
        `supersededBy` propre** — vérifié directement dans
        `prisma/schema.prisma` (l'entrée ne porte que `id`/`decisionId`/
        `candidateSelectionId`/`statut`/`justification`). La supersession
        est une propriété de la `CandidateFinalDecision` **parente**
        (`supersedesId`/`supersededBy`), jamais de l'entrée elle-même. Une
        entrée appartenant à une décision devenue non active
        (`decision.supersededBy !== null`) n'est donc **jamais** réutilisée
        comme cible — non pas parce qu'elle porterait elle-même une marque
        de supersession (elle n'en porte aucune), mais parce que (iii)
        exige que l'entrée cible appartienne à la `CandidateFinalDecision`
        **active** courante (`supersededBy: null` sur la décision
        **parente**) et porte `statut = RETENU` : c'est la décision
        source active qui doit elle-même fournir l'entrée cible, jamais
        une décision antérieure, quel que soit l'`id` d'entrée encore
        connu. Aucun champ ni relation `supersededBy` n'est ajouté ou
        supposé exister sur `CandidateFinalDecisionEntree` par cette
        précision.
      - vii. La chaîne `supersedesId` et l'historique append-only sont
        préservés intégralement — le successeur référence toujours le
        prédécesseur par `supersedesId`, quelle que soit l'entrée cible.
      Si l'un de ces contrôles échoue : refus explicite (ex.
      `SupersedesInvalideError`, 409).
   e. Vérifier qu'**aucune autre** `CandidateProposal` active
      (`BROUILLON`/`EMISE`/`ACCEPTEE`) n'existe déjà pour cette
      `candidateFinalDecisionEntreeId` (sauf celle désignée par
      `supersedesId`, qui est terminale par construction du point d) —
      sinon refus explicite (ex. `PropositionActiveExistanteError`, 409).
   f. Créer la ligne `BROUILLON`.
4. **Audit** : **aucun** — un `BROUILLON` n'est ni visible du Client ni un
   fait métier engageant (cohérent avec CTO Validation §16 : seules les
   transitions métier significatives sont journalisées).

### 6.2 Émission (`BROUILLON → EMISE`)

1. **RBAC** : ADMIN uniquement → 403 sinon.
2. **Tenant** : charger la proposition par `id` + `clientId` de session
   (si la route est Admin-générale, le tenant est dérivé de la ressource
   elle-même, jamais du body) → 404 si introuvable.
3. **Transaction Serializable+retry** :
   a. Relire la proposition. Si `statut` n'est ni `BROUILLON` ni `EMISE` →
      refus explicite (409, transition invalide).
   b. **Si `statut === "EMISE"` déjà** (course gagnée par une autre
      requête concurrente avant celle-ci) → **branche IDEMPOTENTE** :
      retourner la ligne existante (200) et **passer directement à
      l'étape 4bis** — l'étape 4 (effets de bord) n'est **jamais**
      exécutée pour cette branche.
   c. Revalider la complétude du snapshot commercial (tous les champs
      requis renseignés) — sinon refus (400).
   d. Revérifier la fraîcheur de la décision source (même requête que
      §6.1.c) — une décision source supersédée **entre la création du
      brouillon et son émission** bloque l'émission, jamais une émission
      sur base obsolète (invariant 7/8).
   e. `updateMany({ where: { id, statut: "BROUILLON" }, data: { statut: "EMISE", emisLe: now(), emisParEmail: session.email } })` — **conditional update + count**, même pattern que §2.5.
      - **Si `count === 1`** : cette requête a réellement effectué la
        mutation → **branche GAGNANTE**, passer à l'étape 4.
      - **Si `count === 0`** (course perdue contre une autre requête
        d'émission ou un retrait concurrent) : relire l'état réel **dans
        la même transaction** et appliquer exactement la logique de (b)
        — idempotent si `EMISE`, refus explicite sinon (ex. `RETIREE`
        entre-temps). **Jamais une seconde tentative d'`update`.**
4. **Après commit, uniquement pour la branche gagnante (`count === 1` à
   l'étape 3.e)** : `journaliser({ action: "candidate.proposal.emitted", acteurEmail: emisParEmail, acteurRole: "ADMIN", cible: "proposal:<id> entree:<candidateFinalDecisionEntreeId>" })` — best-effort. Email Client best-effort, `void`, jamais bloquant.
4bis. **Pour la branche idempotente (3.b, ou la relecture de 3.e qui
   constate `EMISE`)** : **aucun** `journaliser()`, **aucun** email —
   **corrigé A35.4/F2**. Un code HTTP 200 ne signifie, à lui seul, jamais
   que *cette* requête a exécuté la transition ; seule la branche gagnante
   de l'étape 3.e déclenche les effets de bord de l'étape 4, exactement
   une fois par transition réelle, quel que soit le nombre de requêtes
   concurrentes visant le même résultat.

### 6.3 Acceptation / Refus (`EMISE → ACCEPTEE`/`REFUSEE`)

Algorithme central, directement dérivé du Design Contract §10.2/§10.5.

1. **RBAC** : `session.role === "CLIENT" && session.clientId` **ou**
   (`session.role === "ADMIN"` **et** `communiqueParClientHorsSysteme === true`
   **et** `canalHorsSysteme` non vide, même schéma Zod étendu que
   `app/api/talent/demandes/[id]/final-decision/route.ts`, §2.2) — sinon
   403. `decideParRole` est **toujours** dérivé de la session, jamais lu
   du body (même discipline que la route Client existante).
2. **Tenant** : charger la proposition par `id` + `clientId` (CLIENT) ou
   par `id` seul avec re-vérification tenant explicite (ADMIN) → 404 si
   introuvable ou mauvais tenant (jamais 403 distinctif).
3. **Transaction Serializable+retry** :
   a. Relire la proposition **dans la transaction**. Calculer
      `calculerStatutEffectif(proposal, now())` (§5.2). Si le résultat
      n'est pas `"EMISE"` :
      - Si le résultat **égale déjà** la décision demandée (ex. demande
        `ACCEPTEE` et `statut` est déjà `ACCEPTEE` avec le **même**
        `decideParEmail`) → **branche IDEMPOTENTE** : retourner l'état
        existant (200) et **passer directement à l'étape 5bis** — l'étape
        5 (effets de bord) n'est **jamais** exécutée pour cette branche
        — **corrigé A35.4/F2**.
      - Sinon (ex. `EXPIREE` dérivée, ou `REFUSEE` par quelqu'un d'autre,
        ou demande `REFUSEE` alors que déjà `ACCEPTEE`) → **branche de
        conflit** : refus explicite (409) — **jamais un conflit traité
        comme un succès implicite** (mandat §6).
   b. Revérifier la fraîcheur de la décision source : charger
      `CandidateFinalDecisionEntree` + `CandidateFinalDecision` parente
      via `candidateFinalDecisionEntreeId` ; si `decision.supersededBy !== null`
      ou `entree.statut !== "RETENU"` → refus explicite (409) — **jamais**
      une acceptation sur décision supersédée (invariant 7/8).
   c. `updateMany({ where: { id, statut: "EMISE" }, data: { statut: <ACCEPTEE|REFUSEE>, decideLe: now(), decideParEmail: session.email, communiqueParClientHorsSysteme, canalHorsSysteme } })` — conditional update + count.
      - **Si `count === 1`** : cette requête a réellement effectué la
        mutation → **branche GAGNANTE**, passer à l'étape 5.
      - **Si `count === 0`** : une course concurrente a déjà transitionné
        la ligne entre (a) et (c) — relire l'état réel **dans la même
        transaction** et appliquer exactement la même logique idempotent/
        conflit qu'en (a), y compris le renvoi vers l'étape 5bis pour le
        cas idempotent. **Jamais une seconde tentative d'update.**
   d. Retourner la ligne mise à jour (branche gagnante) ou l'état existant
      (branche idempotente, §5bis) — **numérotation resserrée A35.6**
      (l'ancienne étape (d), simple note de traçabilité sans contenu
      propre, est supprimée ; son contenu était déjà intégralement dans
      (c) ci-dessus — aucun changement de logique de transition).
4. **Retry `P2034`** : relance intégralement les étapes (a)-(e) avec un
   état frais — jamais une résolution optimiste sur l'état lu avant le
   conflit.
5. **Après commit, uniquement pour la branche gagnante (`count === 1` à
   l'étape 3.c)** : `journaliser({ action: "candidate.proposal.accepted" | "candidate.proposal.rejected", ... })` — une seule action par transition, quel que soit le canal (§9, règle CTO Validation §16 reprise). Email best-effort après commit, jamais avant, jamais dans la transaction (invariant 13).
5bis. **Pour la branche idempotente (3.a, ou la relecture de 3.c qui
   constate que la cible est déjà atteinte)** : **aucun** `journaliser()`,
   **aucun** email — **corrigé A35.4/F2**. Seule la requête qui a
   effectivement réalisé la transition métier (branche gagnante de
   l'étape 3.c) déclenche les effets de bord associés à cette transition ;
   `journaliser()` n'est jamais exécuté une seconde fois pour une
   transition déjà réalisée, même si cette seconde requête reçoit
   également un 200.

**Distinction retry technique / nouvelle intention métier** (Design
Contract §10.2/§11.2) : un retry `P2034` relit et reconclut sur les
**mêmes paramètres d'entrée** de l'appel HTTP en cours — il n'invente
jamais une nouvelle intention. Une **seconde requête HTTP** distincte
(double-clic) est gérée par le conditional-update (étape 3.c), qui
distingue nativement idempotence (même décision déjà atteinte) et
conflit (décision différente déjà atteinte).

### 6.4 Retrait (`BROUILLON`/`EMISE → RETIREE`)

1. **RBAC** : ADMIN uniquement.
2. **Transaction Serializable+retry** : `updateMany({ where: { id, statut: { in: ["BROUILLON", "EMISE"] } }, data: { statut: "RETIREE", retireeLe: now() } })`.
   - **Si `count === 1`** : cette requête a réellement effectué la
     mutation → **branche GAGNANTE**, passer à l'étape 3. L'état
     `EMISE` ou `BROUILLON` observé **avant** cet `updateMany` (dans la
     même transaction) détermine si la proposition avait quitté
     `BROUILLON`, pour l'étape 3.
   - **Si `count === 0`** : relire l'état réel **dans la même
     transaction** — si déjà `RETIREE` → **branche IDEMPOTENTE** :
     retourner l'état existant (200) et **passer directement à l'étape
     3bis**, l'étape 3 n'étant **jamais** exécutée pour cette branche ;
     si l'état est `ACCEPTEE`/`REFUSEE` (transition terminale déjà
     atteinte par une autre requête) → **refus explicite** (409), jamais
     un retrait rétroactif d'un état terminal. **Jamais une seconde
     tentative d'update.**
3. **Après commit, uniquement pour la branche gagnante (`count === 1` à
   l'étape 2)** : `journaliser({ action: "candidate.proposal.withdrawn", ... })`. Email best-effort si la proposition était `EMISE` avant le retrait (le Client avait été notifié de l'émission) ; aucun email si elle n'a jamais quitté `BROUILLON`.
3bis. **Pour la branche idempotente (2, cas `count === 0` constatant déjà
   `RETIREE`)** : **aucun** `journaliser()`, **aucun** email — **corrigé
   A35.4/F2**. Un second retrait d'une proposition déjà `RETIREE` ne
   journalise jamais une deuxième fois la même transition.

---

## 7. Anti-double-Mission

Traduction opérationnelle exacte du Design Contract §11.2 (D2, intégralement
`LOCKED`).

### 7.1 Identité et garantie

- **Identité d'unicité métier** : l'`id` de la `CandidateProposal`
  `ACCEPTEE` (invariant 2) — jamais un champ recalculé.
- **Garantie exigée** : `Mission.sourceCandidateProposalId String? @unique`
  (champ additif, compatibilité vérifiée sans conflit, §2.4). La séquence
  d'implémentation (§13) garantit que ce champ existe en base **avant**
  que le service de §7.2 ne soit jamais implémenté ou appelé (Étape 1
  précède strictement Étape 2) — **aucune variante de déploiement sans ce
  champ n'est autorisée** ; il n'existe donc, à aucun moment du cycle de
  vie de ce lot, de fenêtre où §7.2 s'exécuterait sans la contrainte
  `@unique` déjà en place **(corrigé A35.4/F4 — le scénario "transitoire"
  précédemment décrit ici était contredit par §13 lui-même et a été
  retiré, sans en substituer un autre)**.
- La transaction `Serializable`+retry relisant explicitement "existe-t-il
  déjà une `Mission` avec `sourceCandidateProposalId = <id>`" avant
  `create()` (§7.2.a) reste **néanmoins obligatoire** — elle n'est jamais
  remplacée par la seule contrainte `@unique`, mais s'y ajoute en défense
  en profondeur (voir §7.2.d, gestion explicite de `P2002`) : la
  contrainte DB garantit l'intégrité même en cas de défaillance de la
  lecture préalable ; la lecture préalable évite de déclencher
  inutilement une erreur de contrainte dans le flux normal. Jamais un
  `findFirst()` + `create()` hors transaction (exclu explicitement,
  Design Contract §11.2).

### 7.2 Algorithme de création/reprise de Mission depuis une proposition acceptée

1. **RBAC** : ADMIN uniquement (même route `POST /api/missions` existante,
   étendue — jamais une nouvelle route de création de Mission, §10.7).
2. **Précondition** : la `CandidateProposal` référencée doit avoir
   `calculerStatutEffectif() === "ACCEPTEE"` — sinon refus explicite (400).
   **Aucune revérification de la fraîcheur de la décision source
   (`CandidateFinalDecision`/`CandidateFinalDecisionEntree`) n'est
   effectuée à cette étape, ni ailleurs dans ce service (corrigé
   A35.4/F5)** : cette fraîcheur a déjà été vérifiée de façon atomique à
   l'émission (§6.2.3.d) et à l'acceptation (§6.3.3.b) — une fois
   `ACCEPTEE`, la proposition est **terminale et immuable** (invariant
   3, Design Contract §7.4). Une quatrième vérification ici reviendrait à
   rouvrir implicitement une décision déjà verrouillée par l'acceptation
   elle-même : si la décision source est supersédée **après**
   l'acceptation, cela ne remet jamais en cause une `CandidateProposal`
   déjà `ACCEPTEE`, et ne bloque donc jamais la création ou la reprise de
   Mission qui en découle.
3. **Transaction Serializable+retry** :
   a. Relire s'il existe déjà une `Mission` avec `sourceCandidateProposalId = proposalId`.
   b. **Si aucune n'existe** : créer la `Mission` avec les champs requis
      existants (`clientId` dérivé de la proposition, `profilId`/
      `nbJours`/`tjmVente` saisis/confirmés par l'Admin — jamais hérités
      aveuglément du snapshot, §11.1 Design Contract), `needVersionId` et
      `solutionDecisionId` **toujours `null`** (invariant 17),
      `sourceCandidateProposalId = proposalId`.
   c. **Si une `Mission` existe déjà** (détectée en (a)) :
      - Paramètres de la requête **identiques** à ceux de la `Mission`
        existante (même `profilId`/`nbJours`/`tjmVente`/`clientId`) →
        **réponse idempotente** : retourner la `Mission` existante (200),
        **jamais une seconde ligne**.
      - Paramètres **différents** → **refus explicite 409** — la première
        `Mission` reste autoritaire, jamais réécrite, jamais doublée
        (invariant 15).
   d. **Défense en profondeur — gestion explicite de `P2002` (corrigé
      A35.4/F3, précisé A35.6/F3)** : la lecture (a) sous `Serializable`
      élimine la plupart des phantom-insert, mais, exactement comme le
      précédent cité §7.1 (`creerCandidateFinalDecisionAvecRetry`, qui
      traite `P2002` indépendamment de `P2034`), le `create()` de (b)
      **doit** être entouré d'une gestion explicite de la violation de
      contrainte unique `sourceCandidateProposalId`. **Stratégie de
      détection — ne jamais dépendre exclusivement d'une comparaison de
      chaîne codée en dur sur un nom de contrainte** :
      1. Vérifier que l'erreur est bien une instance de
         `Prisma.PrismaClientKnownRequestError` avec `erreur.code ===
         "P2002"` — toute autre erreur (y compris un autre code Prisma)
         n'entre jamais dans ce traitement.
      2. Identifier, à partir des métadonnées disponibles sur cette
         erreur (`erreur.meta`), si la contrainte violée concerne
         précisément `sourceCandidateProposalId` — typiquement via
         `erreur.meta?.target`, qui porte le ou les noms de colonnes/
         contraintes concernés selon le connecteur Prisma utilisé (ce
         dépôt utilise `@prisma/client` en version `5.18.x`, vérifié dans
         `package.json` — **lecture documentaire du code uniquement,
         aucune validation runtime du contenu effectif de
         `erreur.meta?.target` n'a été effectuée par ce contrat**).
      3. **Ne jamais supposer une représentation unique** de ces
         métadonnées : selon la version de Prisma et le connecteur,
         `target` peut être un tableau de noms de colonnes, une chaîne,
         ou absent. L'implémentation doit donc tester la présence du nom
         de champ `sourceCandidateProposalId` dans cette structure quelle
         que soit sa forme exacte (tableau ou chaîne), jamais une égalité
         stricte sur un nom de contrainte composé (`Mission_..._key`)
         supposé fixe.
      4. **Ne jamais assimiler automatiquement tout `P2002` sur `Mission`
         à un conflit de provenance** : un `P2002` provenant d'une autre
         contrainte unique du modèle (actuelle ou future) ne doit jamais
         être traité par cette branche.
      5. **Si les métadonnées sont absentes ou ne permettent pas
         d'identifier la contrainte avec certitude** : ne jamais fabriquer
         un succès idempotent ni un conflit métier supposé — traiter ce
         cas comme un `P2002` non identifié (voir point 9 ci-dessous),
         jamais une résolution optimiste.
      6. Une fois la contrainte identifiée avec certitude comme portant
         sur `sourceCandidateProposalId` : **rollback implicite de
         l'écriture** (déjà actée par l'échec de la transaction), puis
         relire la `Mission` existante avec `sourceCandidateProposalId =
         proposalId` **dans une nouvelle lecture**, hors de la
         transaction/écriture en échec.
      7. Si une `Mission` correspondante est trouvée et que ses
         paramètres déterminants (`profilId`/`nbJours`/`tjmVente`/
         `clientId`) sont **identiques** à ceux de la requête en cours →
         appliquer exactement la logique idempotente de (c) (200, pas de
         seconde ligne).
      8. Si une `Mission` correspondante est trouvée mais que ses
         paramètres **diffèrent** → appliquer exactement la logique de
         conflit de (c) (409).
      9. Si **aucune** `Mission` correspondante n'est trouvée, ou si la
         contrainte violée ne peut pas être identifiée avec certitude
         comme `sourceCandidateProposalId` (métadonnées absentes,
         ambiguës, ou portant sur une contrainte différente) : **ne
         jamais masquer l'erreur** — elle est remontée comme une erreur
         inattendue (500), jamais interprétée silencieusement comme un
         succès ou un conflit métier.

      Cette stratégie reste pleinement compatible avec l'isolation
      `Serializable`, le retry sur `P2034` (qui continue de s'appliquer
      indépendamment — un `P2034` reste relancé par la boucle
      `MAX_TENTATIVES`, jamais traité par cette branche `P2002`) et avec
      le caractère obligatoire de la contrainte unique en base (§7.1) :
      la contrainte `@@unique` reste la garantie d'intégrité ultime,
      cette gestion de `P2002` n'en est que la traduction applicative
      sûre, jamais un substitut.
3bis. **Audit après commit (corrigé A35.4/F7)** : **uniquement pour la
   branche qui a effectivement créé la `Mission`** (3.b réussi, ou la
   branche de récupération de 3.d qui aboutit à une création — jamais les
   branches idempotentes de 3.c ou 3.d) :
   `journaliser({ action: "candidate.proposal.mission_created", acteurEmail: session.email, acteurRole: "ADMIN", cible: "proposal:<proposalId> mission:<mission.id>" })`
   — best-effort, après commit, jamais dans la transaction (invariant 13).
   **Aucun `journaliser()`** pour les branches idempotentes (une
   `Mission` déjà existante retournée en 200 ne journalise jamais une
   seconde fois sa création) ni pour la branche de conflit (409). Ceci
   **n'introduit aucun nouveau système d'audit générique** et n'implique
   **aucun changement** au comportement d'audit actuel — aujourd'hui
   absent — de `POST /api/missions` pour une création de `Mission`
   **ordinaire, non liée à une `CandidateProposal`** : cette action
   d'audit ne se déclenche que sur le chemin spécifique de ce service
   (§7.2), jamais sur le chemin de création manuelle existant.
   **Précision sur l'échec d'audit (ajouté A35.6/F7)** : `journaliser()`
   (`lib/audit.ts`, vérifié) écrit après commit en mode best-effort — en
   cas d'échec d'écriture, l'erreur est uniquement signalée par le
   mécanisme déjà existant (`console.error`, capturé en interne par
   `journaliser()` lui-même), **jamais relancée** vers l'appelant ;
   l'échec de cette écriture d'audit **n'annule jamais** la `Mission`
   déjà créée et commitée. Ce contrat **n'ajoute aucune nouvelle
   infrastructure** d'audit, aucun retry dédié à `journaliser()`, aucun
   mécanisme d'alerte — l'audit de `candidate.proposal.mission_created`
   n'est ni durable ni garanti « exactement une fois » au sens strict :
   seule l'exécution de la transition métier (la création de `Mission`
   elle-même) l'est ; l'écriture de la ligne d'audit correspondante reste
   soumise au même risque best-effort que toutes les autres actions
   d'audit de ce domaine (§9).
4. **Jamais de réinitialisation de l'acceptation en cas d'échec** : si
   l'étape 3 échoue pour une raison transitoire (hors `P2034`, qui est
   déjà retryé), la `CandidateProposal` **reste `ACCEPTEE`** — aucune
   route ne doit jamais la ramener à `EMISE` ou tout autre état (invariant
   3, Design Contract §7.4). La reprise se fait en **ré-appelant cette
   même opération** (idempotente par construction, étape 3.c).
5. **Mission sans provenance** : une `Mission` dont
   `sourceCandidateProposalId IS NULL` (créée par le flux Admin ordinaire,
   ou avant l'existence du champ) n'est **jamais** rattachée après coup
   par une correspondance heuristique (même profil/client/date) — un
   rattachement rétroactif, si un jour nécessaire, est une action humaine
   explicite hors du périmètre de cette opération (invariant 16).

---

## 8. RBAC et tenant isolation

### 8.1 Table d'autorisation par opération

| Opération | CLIENT | ADMIN | INGENIEUR | AGENT |
|---|---|---|---|---|
| Créer un `BROUILLON` | 403 | ✅ | 403 | 403 |
| Lire ses propres propositions (`EMISE`/`ACCEPTEE`/`REFUSEE`, jamais `BROUILLON`) | ✅ (son tenant uniquement) | ✅ (tout tenant) | 403 | 403 |
| Lire un `BROUILLON` | 403 | ✅ | 403 | 403 |
| Émettre (`EMISE`) | 403 | ✅ | 403 | 403 |
| Accepter / Refuser | ✅ (son tenant uniquement) | ✅ (hors-système uniquement, §8.2 Design Contract) | 403 | 403 |
| Retirer (`RETIREE`) | 403 | ✅ | 403 | 403 |
| Créer/reprendre une `Mission` depuis une proposition acceptée | 403 | ✅ | 403 | 403 |

**Aucune autorisation ne repose sur l'UI** — chaque route applique son
propre guard `getSession()` + vérification de rôle/tenant, exactement
comme `app/api/client/.../final-decision/route.ts` et
`app/api/talent/.../final-decision/route.ts` (§2.2), avant toute lecture
métier.

### 8.2 Tenant isolation

- Toute route Client scope par `session.clientId`, jamais par un
  identifiant du body.
- 404 uniforme pour une ressource d'un autre tenant ou inexistante —
  jamais 403 distinctif (même convention que tout le domaine Candidate
  Decision + Interview, revérifiée §2.2).
- `candidateFinalDecisionEntreeId`/`candidateProposalId` ne sont jamais
  acceptés comme entrée suffisante côté Client — toujours revalidés
  contre `demandeTalentId`/`clientId` dérivés de la session.

### 8.3 Middleware

Aucune modification requise — confirmé §2.6.

---

## 9. Audit

Reprise exacte du Design Contract §9, avec acteur/cible/résultat précisés.

| Action | Déclenchée par | Acteur (`acteurRole`) | Cible | Résultat journalisé |
|---|---|---|---|---|
| `candidate.proposal.emitted` | §6.2 | `ADMIN` | `proposal:<id> entree:<candidateFinalDecisionEntreeId>` | Transition réussie uniquement (jamais un refus) |
| `candidate.proposal.accepted` | §6.3 | `CLIENT` ou `ADMIN` (canal capturé par `communiqueParClientHorsSysteme`, jamais une action distincte — CTO Validation §16) | `proposal:<id>` | idem |
| `candidate.proposal.rejected` | §6.3 | idem | `proposal:<id>` | idem |
| `candidate.proposal.withdrawn` | §6.4 | `ADMIN` | `proposal:<id>` | idem |
| `candidate.proposal.mission_created` **(ajouté A35.4/F7)** | §7.2 (3bis) | `ADMIN` | `proposal:<id> mission:<missionId>` | Branche de création réelle uniquement (jamais les branches idempotentes 3.c/3.d, jamais la branche de conflit 409) |
| *(aucune action pour `EXPIREE`)* | — | — | — | Aucune écriture, donc rien à journaliser (§9 Design Contract) |
| *(aucune action pour la création de `BROUILLON`)* | — | — | — | Pas une transition métier significative (§6.1) |

**Aucun nouveau système d'audit générique** — réutilisation stricte de
`journaliser()` (`lib/audit.ts`), best-effort, jamais bloquant pour la
transaction métier. `candidate.proposal.mission_created` est scopée au
seul chemin de §7.2 (création/reprise de `Mission` depuis une proposition
acceptée) — elle n'introduit, n'implique et ne requiert **aucun**
changement au comportement d'audit actuel de `POST /api/missions` pour
une création de `Mission` ordinaire, non liée à une `CandidateProposal`
(confirmé par lecture directe de `app/api/missions/route.ts` : aucun
appel `journaliser()` existant aujourd'hui sur ce chemin, et ce lot ne
le modifie pas — corrigé A35.4/F7). **Précision sur l'échec d'audit
(ajouté A35.6/F7)** : pour les cinq actions de ce tableau,
`journaliser()` (`lib/audit.ts`, vérifié) écrit toujours **après**
commit, en mode best-effort — un échec d'écriture est uniquement
signalé par le mécanisme déjà existant (`console.error` interne à
`journaliser()`), jamais relancé, et n'annule jamais la transition
métier déjà commitée. Aucune nouvelle infrastructure d'audit, aucun
retry dédié, aucun mécanisme d'alerte n'est ajouté par ce contrat —
l'audit reste un effet de bord best-effort, jamais une garantie de
durabilité ni une livraison « exactement une fois » au sens strict pour
la ligne d'audit elle-même (seule la transition métier sous-jacente
l'est, §6/§7).

---

## 10. API contractuelle

Contrat uniquement — **aucune route n'est créée par ce document**. Chaque
entrée précise autorité, validations, erreurs métier et contrôles de
sécurité.

### 10.1 `POST /api/talent/demandes/[id]/candidate-proposals` — création d'un `BROUILLON`

- **Autorité** : ADMIN.
- **Body** : `{ candidateFinalDecisionEntreeId, supersedesId? }` (le
  snapshot commercial peut être fourni ici ou laissé pour une étape
  d'édition ultérieure du `BROUILLON` — détail **IMPLEMENTATION DETAIL**,
  sans impact sur l'algorithme §6.1).
- **Validations** : §6.1 (entrée `RETENU`, décision active, `supersedesId`
  terminal et sur la même entrée, aucune autre proposition active).
- **Erreurs** : 403 (rôle), 404 (entrée/décision introuvable ou mauvais
  tenant), 400 (entrée non `RETENU`), 409 (décision non active,
  `supersedesId` invalide, proposition active déjà existante).

### 10.2 `GET /api/talent/demandes/[id]/candidate-proposals` — lecture Admin

- **Autorité** : ADMIN.
- **Erreurs** : 403, 404 (demande introuvable).

### 10.3 `GET /api/client/talent-selection/demandes/[demandeId]/candidate-proposals` — lecture Client

- **Autorité** : CLIENT, scoping `session.clientId`.
- **Filtre** : exclut systématiquement les lignes `BROUILLON` (jamais
  visibles côté Client, §8.1 Design Contract).
- **Erreurs** : 403, 404 (demande d'un autre tenant ou inexistante).

### 10.4 `PATCH /api/talent/demandes/[id]/candidate-proposals/[proposalId]/emettre` — émission

- **Autorité** : ADMIN.
- **Validations/Erreurs** : §6.2 — 403, 404, 400 (snapshot incomplet), 409
  (transition invalide, décision source non active).

### 10.5 `POST /api/client/talent-selection/demandes/[demandeId]/candidate-proposals/[proposalId]/accepter` et `.../refuser`

- **Autorité** : CLIENT exclusif (scoping tenant).
- **Validations/Erreurs** : §6.3 — 403, 404, 409 (expirée, décision source
  non active, conflit avec une décision déjà atteinte différente). 200
  idempotent si la même décision est déjà atteinte.

### 10.6 `POST /api/talent/demandes/[id]/candidate-proposals/[proposalId]/decision-hors-systeme`

- **Autorité** : ADMIN, body étendu `{ reponse: "ACCEPTEE"|"REFUSEE", communiqueParClientHorsSysteme: true, canalHorsSysteme }` — même discriminant Zod que `app/api/talent/demandes/[id]/final-decision/route.ts` (§2.2).
- **Validations/Erreurs** : identiques à §6.3, plus 400 si
  `communiqueParClientHorsSysteme`/`canalHorsSysteme` absents.

### 10.7 `PATCH /api/talent/demandes/[id]/candidate-proposals/[proposalId]/retirer`

- **Autorité** : ADMIN. Voir §6.4.

### 10.8 Création/reprise de `Mission` depuis une proposition acceptée

- **Autorité** : ADMIN. **Extension du body existant** de
  `POST /api/missions` (`app/api/missions/route.ts`, §2.4) avec un champ
  optionnel `candidateProposalId` — **jamais une nouvelle route de
  création de Mission** (cohérent avec "un seul chemin de création",
  même discipline que `sourceDemandeId`, LOT 6).
- **Validations/Erreurs** : §7.2 — 400 (proposition non `ACCEPTEE`), 404
  (proposition introuvable/mauvais tenant), 409 (paramètres différents
  d'une `Mission` déjà liée), 200/201 idempotent sinon.

**Visibilité des données candidat** : aucune route Client (§10.3, §10.5)
n'expose de donnée candidat au-delà de ce qui est déjà autorisé par le
point d'autorisation existant (`idPublicIngenieur`, anonymisation —
précédent du domaine Candidate Decision + Interview) — ce contrat
n'introduit aucune nouvelle exposition de données protégées.

---

## 11. UI contractuelle

Contrat uniquement — **aucune page n'est créée ou modifiée**.

- **Admin** : extension de la page existante de décision finale
  (précédent `app/admin/talent/[id]/page.tsx` / `InterviewsAdmin.tsx`,
  domaine Candidate Decision + Interview) avec une section "Propositions
  commerciales" : création de `BROUILLON`, édition tant que `BROUILLON`,
  émission, retrait, enregistrement hors-système, et un point d'entrée
  vers la création/reprise de `Mission` depuis une proposition `ACCEPTEE`.
- **Client** : extension de la page existante
  `app/client/talent/SelectionEtEntretiens.tsx` (même précédent que la
  comparaison/shortlist déjà anonymisées) avec une vue de ses propositions
  `EMISE`/`ACCEPTEE`/`REFUSEE` et les actions Accepter/Refuser.

Aucune nouvelle page, aucun nouveau composant générique — extension de
pages déjà existantes et déjà conformes aux conventions RBAC/tenant du
dépôt.

---

## 12. Matrice de tests

Aucun test n'est écrit ici — matrice future, séparée par nature.

### 12.1 Tests unitaires

| Scénario | Fonction testée |
|---|---|
| `calculerStatutEffectif()` sur tous les cas limites de `dateValidite` | §5.2 |
| Table des transitions autorisées, y compris transitions interdites | §5.3 |

### 12.2 Tests de service transactionnel

| Scénario | Référence |
|---|---|
| Entrée source non `RETENU` → refus création | §6.1.b |
| Décision source supersédée → refus création d'un nouveau `BROUILLON` | §6.1.c |
| Décision source supersédée → refus acceptation | §6.3.b |
| Décision source supersédée → refus création d'un successeur (`supersedesId`) | §6.1.d, invariant 7 |
| Snapshot immuable : modification d'une donnée source après émission → aucun changement sur le snapshot déjà figé | §4.2 |
| Acceptation concurrente réelle (`Promise.all`, deux contextes) → assertion sur l'état persisté, jamais seulement le code HTTP | §6.3 |
| Double soumission (même décision deux fois) → idempotent, un seul email/audit déclenché | §6.3.a |
| Double soumission (décisions différentes en conflit) → 409 explicite, jamais un succès implicite | §6.3.a |
| Idempotence de la création de `Mission` (mêmes paramètres, deux appels) → une seule `Mission` | §7.2.c |
| Conflit avec une `Mission` déjà liée (paramètres différents) → 409 explicite | §7.2.c |
| `Mission` sans provenance → jamais rattachée automatiquement | §7.2.5 |
| Contrainte d'unicité de provenance : violation `@@unique` (`P2002`) sur `sourceCandidateProposalId` détectée et traduite en idempotent (200, mêmes paramètres) ou conflit (409, paramètres différents) — jamais masquée **(précisé A35.4/F3/F4 : le champ existe toujours à ce stade, §7.1/§13 étape 1)** | §7.2.d |
| Absence d'effets externes avant commit : transaction métier échouée → aucun email/audit déclenché | invariant 13 |

### 12.3 Tests API / intégration

| Scénario | Référence |
|---|---|
| RBAC complet : 403 pour INGENIEUR/AGENT sur chaque opération | §8.1 |
| Tenant isolation / IDOR : Client A sur une proposition de Client B → 404 | §8.2 |
| Audit : écriture `journaliser()` vérifiée sur chaque transition réussie, une seule action par type quel que soit le canal | §9 |
| Non-régression des décisions finales existantes (`CandidateFinalDecision`/`Entree` restent créables/consultables sans changement de comportement) | invariant 1 |
| Non-régression A18/A19 : `validerPinsMission()` inchangé, `needVersionId`/`solutionDecisionId` toujours `null` pour une `Mission` issue de cette chaîne | invariant 17 |
| Non-régression `POST /api/missions` : le comportement existant (sans `candidateProposalId`) reste identique | §10.8 |

---

## 13. Séquence d'implémentation

Chaque étape porte ses propres critères d'acceptation (repris aussi en
§14).

### Étape 1 — Schéma et migration additive

- Ajouter le modèle `CandidateProposal` (champs §3.2), l'enum de statut
  (§5.1), et le champ additif `Mission.sourceCandidateProposalId String? @unique`.
- **Aucun backfill (corrigé A35.4/F8)** : les `Mission` historiques
  conservent `sourceCandidateProposalId = NULL` — Postgres autorise
  plusieurs `NULL` sous une contrainte `@unique` (vérifié §2.4), donc
  aucune valeur n'est requise ni déduite pour les lignes existantes.
  **Aucune association rétroactive par heuristique** (même
  profil/client/date, ou toute autre correspondance déduite) n'est
  effectuée par cette migration ou par ce lot — identique à l'invariant
  16 (§7.2.5) : un rattachement rétroactif, si un jour nécessaire, reste
  une action humaine explicite, hors du périmètre de cette migration.
- **Critère d'acceptation** : migration additive uniquement (aucune
  colonne existante modifiée/supprimée), `prisma validate`/`generate`
  propres, aucune donnée existante affectée, zéro backfill exécuté.

### Étape 2 — Services métier et invariants transactionnels

- Implémenter les algorithmes §6 (création, émission, acceptation/refus,
  retrait) et §7 (anti-double-Mission).
- **Critère d'acceptation** : tous les scénarios de §12.2 passent ; `tsc
  --noEmit` propre.

### Étape 3 — Routes et sécurité

- Implémenter les 8 routes de §10, guards RBAC/tenant identiques au
  patron §2.2.
- **Critère d'acceptation** : tous les scénarios de §12.3 passent ; aucune
  route n'est accessible sans le guard correspondant.

### Étape 4 — UI minimale

- Étendre les deux pages existantes citées en §11.
- **Critère d'acceptation** : parcours Admin (brouillon → émission →
  suivi) et Client (lecture → acceptation/refus) fonctionnels en
  environnement de test, sans régression des pages existantes.

### Étape 5 — Tests et non-régression

- Exécuter la matrice complète §12, plus la suite
  `candidate-decision-interview.spec.ts` et les tests A18
  (`a18-mission-need-pinning.spec.ts`) pour non-régression.
- **Critère d'acceptation** : 100 % des scénarios de §12 verts ; zéro
  régression détectée sur les suites existantes.

### Étape 6 — Audit final du scope

- Revue de diff : confirmer qu'aucun fichier hors du périmètre de ce
  contrat n'a été touché, qu'aucun des 19 invariants (§1.2) n'a été
  contourné, et que les exclusions (§16) sont respectées.
- **Critère d'acceptation** : rapport d'audit explicite, verdict
  ACCEPTED/BLOCKED, avant toute demande de merge.

---

## 14. Critères d'acceptation (consolidés)

Le lot est considérable comme implémenté correctement seulement si,
cumulativement : (1) les 19 invariants de §1.2 sont vérifiables dans le
code livré ; (2) la matrice de tests §12 est intégralement verte ; (3)
aucune route existante (`POST /api/missions`, les deux routes de décision
finale) n'a changé de comportement pour un appelant qui n'utilise pas les
nouveaux champs optionnels ; (4) aucune dépendance de §16 n'a été
introduite ; (5) le champ `Mission.sourceCandidateProposalId` porte
effectivement une contrainte `@@unique` en base au plus tard à la fin de
l'étape 1 (pas seulement une vérification applicative, invariant 15/16).

---

## 15. Risques et décisions encore ouvertes

Reprise et consolidation des statuts du Design Contract (§15), aucun
n'est rouvert ni retranché par ce contrat :

| Point | Statut | Traitement dans ce contrat |
|---|---|---|
| Calendrier d'ajout de `Mission.sourceCandidateProposalId` | **IMPLEMENTATION DETAIL** | Fixé à l'étape 1 (§13) — ce contrat choisit de ne pas le différer, conformément à "jamais repoussé indéfiniment" (Design Contract §15/D2) |
| Extension du pinning A18 (`needVersionId`) pour la chaîne Candidate | **OPEN**, hors périmètre | Non traité par ce contrat (invariant 17) — nécessitera son propre contrat si engagé |
| Revue juridique du vocabulaire de production | **EXTERNAL VALIDATION REQUIRED** | Non bloquante pour l'implémentation technique (§16) ; doit intervenir avant tout déploiement en production visible Client |
| Noms exacts des champs du snapshot commercial (§3.2) | **IMPLEMENTATION DETAIL** | Laissés génériques — à fixer avec l'équipe produit/commerciale au moment du schéma Prisma réel, sans qu'aucune valeur ne soit déjà inventée ici |
| Pré-remplissage du formulaire de création de `Mission` (copier le TJM proposé ou seulement l'afficher) | **IMPLEMENTATION DETAIL** (Design Contract §11.1) | Détail UX, sans impact sur l'algorithme §7.2 |
| Index unique partiel pour "au plus une proposition active par Entree" | **IMPLEMENTATION DETAIL**, optionnel | Le mécanisme transactionnel (§3.3) reste la garantie exigée ; l'index partiel n'est jamais une obligation de ce contrat |

**Risque nouvellement identifié par ce contrat** : aucun — la rédaction de
cet algorithme n'a révélé aucune incompatibilité technique non déjà
documentée par le Design Contract (confirmé §2.4 pour la compatibilité du
champ de provenance).

---

## 16. Exclusions

Reprises du mandat, verrouillées comme hors scope de cette implémentation
sans nouvelle validation CTO :

- Signature électronique.
- Validation juridique automatisée.
- Refonte du moteur financier.
- Facturation.
- Notifications externes complexes (seuls les emails best-effort
  conventionnels, §6.2/§6.3/§6.4, sont dans le périmètre).
- Automatisation par Agent.
- Workflow générique de documents.
- Refonte de `Mission` (seul l'ajout additif `sourceCandidateProposalId`
  est dans le périmètre, §13 étape 1 — aucun champ existant n'est modifié).
- Modifications de `WorkItem` ou `Delivery`.
- Nouveau système générique de versioning (réutilisation stricte de
  `supersedesId`/`supersededBy`).
