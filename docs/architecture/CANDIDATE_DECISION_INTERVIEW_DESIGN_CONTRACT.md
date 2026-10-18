# ATLAS — CANDIDATE DECISION + INTERVIEW DESIGN CONTRACT

Document de conception uniquement. Aucun code, migration, API, UI ou test
n'a été créé ou modifié pour produire ce contrat.

Priorité des sources, respectée dans tout ce document : Architecture/métier
ATLAS > décisions explicites ATLAS déjà verrouillées > Design Authority ATLAS
> Design System ATLAS > UX/accessibilité > Claude Design Skills > UI/UX Pro
Max > frontend-design > unslop-ui. Les skills `.claude/skills/` ont été
inspectés (voir listing disponible) ; leurs principes (clarté, hiérarchie,
absence de "card-soup"/glassmorphism/animations gratuites) informent §24-25,
jamais au-dessus d'une contrainte métier ATLAS.

---

## 1. Executive Summary

Ce contrat conçoit la chaîne **Shortlist → Candidate Review → Multi-selection
→ Interview (planification, email, calendrier, rappels) → Evaluation →
Comparison → Final Decision**, en réutilisant intégralement l'existant
confirmé par l'audit (`ClientNeed`, `DemandeTalent`, `ShortlistEntree`,
Matching V2, `Profil`, pseudonymisation). Sept nouveaux objets sont proposés
(`CandidateSelection`, `Interview`, `InterviewParticipant`,
`InterviewEvaluation`, `CandidateFinalDecision`, `InterviewReminder`,
`CalendarSyncRecord`), tous additifs, aucun ne remplace ou ne modifie un
objet existant. Proposal/Mission restent explicitement hors scope. Sept
décisions sont signalées au CTO (§27) — aucune n'empêche ce document d'être
complet, chacune a une recommandation par défaut justifiée et réversible.

## 2. Existing Components (rappel, non modifiés)

| Composant | Rôle conservé |
|---|---|
| `ClientNeed`/`ClientNeedFait` | Besoin business, critères structurés |
| `DemandeTalent` | Staffing V1 (décision CTO déjà actée) |
| `ShortlistEntree` | Shortlist interne Admin, ACTIVE/SUPERSEDED-équivalent (SUGGEREE/VALIDEE/REJETEE) |
| Matching V2 (`lib/talent/matching.ts`) | Moteur de scoring unique, déterministe, 8 facteurs |
| `Profil` | Talent réel, source de toutes les données de matching |
| `idPublicIngenieur` | Pseudonymisation HMAC — base de toute confidentialité candidate |
| `journaliser()` | Mécanisme d'audit à réutiliser, aucun nouveau système |
| `lib/email.ts` | Pattern email best-effort existant, à étendre par de nouveaux templates, jamais une nouvelle infrastructure |

## 3. Product Journey

```
ShortlistEntree (VALIDEE, Admin) ──projection Client──▶ Candidate Review (anonyme)
        → révélation (après sélection) → Candidate Review (détaillé, limité)
        → CandidateSelection (multi-sélection Client)
        → Interview (planification, participants, email, calendrier, rappels)
        → InterviewEvaluation
        → Comparison (lecture factuelle multi-candidats)
        → CandidateFinalDecision
        → [HORS SCOPE] Proposal → Mission
```

Invariant directeur : **Shortlist ≠ Sélection ≠ Decision ≠ Mission** — quatre
objets distincts, jamais fusionnés, jamais l'un ne se substitue à l'autre.

## 4. Candidate Review

- **Vue anonyme** : réutilise exactement le DTO `CandidatAnonyme` existant (9
  champs, `ingenieurId` pseudonymisé) pour l'étape Shortlist→avant-sélection.
- **Passage au profil détaillé — DÉCISION CTO REQUISE (voir §27.1)** :
  proposition : la révélation d'identité (`nom`/`prenom`, jamais email/
  téléphone/CV bruts) n'a lieu **qu'après** l'entrée en `CandidateSelection`
  (le Client s'est explicitement engagé à poursuivre avec ce candidat précis)
  — jamais au stade Shortlist/Review anonyme. Ce seuil reproduit exactement
  le principe déjà appliqué par `GET /api/client/missions` (identité révélée
  seulement une fois un engagement réel — une Mission — existe).
- **CV — DÉCISION CTO REQUISE (voir §27.2)** : proposition : le CV reste
  **non exposé au Client** même après sélection/entretien, par défaut — seul
  l'Admin y accède, cohérent avec la règle déjà posée dans le mandat
  Commercial Architecture ("ne jamais exposer le CV avant que le contrat
  commercial ne l'autorise").
- **Qui révèle quoi** : seul l'ADMIN peut déclencher une révélation
  d'identité plus large que nom/prénom (ex. en cas de besoin exceptionnel) ;
  le Client ne peut jamais obtenir plus que ce que la vue "détaillée" expose
  par défaut.
- **Audit/IDOR** : la vue détaillée résout l'identité **exclusivement**
  depuis la `CandidateSelection`/`DemandeTalent` du Client appelant (jamais un
  `profilId` accepté en paramètre client) — même discipline que l'existant
  (`besoin/matcher`). Le moment de révélation est audité via l'événement de
  sécurité générique déjà existant `objet.consultation` (réutilisation, pas
  de nouvelle entrée de vocabulaire fermé).
- **"Pourquoi ce candidat ?"** : réutilise **exclusivement** les facteurs
  réels de Matching V2 (`MotifScore`/`explication`/`pointsForts`/
  `pointsAmeliorer`/`informationsManquantes` — compétences, séniorité,
  disponibilité, budget, expérience, secteur, localisation, mobilité).
  Aucun facteur inventé, aucune justification générée hors de ce set.

## 5. Multi-selection

- **Nouveau modèle additif** : `CandidateSelection` (voir §20). Représente le
  choix du Client de faire avancer un candidat `ShortlistEntree(VALIDEE)`
  vers l'étape Interview — distinct de `ShortlistEntree` (jamais modifié).
- **Surface de lecture nouvelle — DÉCISION CTO REQUISE (voir §27.3)** :
  pour que le Client puisse sélectionner, il doit d'abord VOIR les entrées
  `ShortlistEntree(VALIDEE)` de sa `DemandeTalent` — aujourd'hui **100%
  Admin-only**, zéro route Client (confirmé par l'audit). Proposition : une
  **nouvelle route de lecture** (Client-facing, filtrée à `statut: VALIDEE`
  uniquement, jamais `SUGGEREE`/`REJETEE`) est nécessaire. Le modèle
  `ShortlistEntree` lui-même n'est ni modifié ni réécrit — seule une
  nouvelle projection de lecture est ajoutée. Ceci change une frontière de
  visibilité jusqu'ici strictement interne — à valider explicitement.
- **Acteurs autorisés** : CLIENT (sélection primaire) ; ADMIN (peut agir au
  nom du Client, cohérent avec le rôle de support Admin déjà établi
  ailleurs dans ATLAS).
- **Retrait/modification** : une `CandidateSelection` peut être retirée
  (`statut: RETIREE`, jamais supprimée physiquement) tant qu'aucun
  `Interview` ne la référence encore. Une fois un `Interview` créé à partir
  d'elle, le retrait reste possible mais n'annule pas rétroactivement
  l'historique des entretiens déjà planifiés (append-only, même discipline
  que `ShortlistEntree`/`CapabilityRequirement`).
- **Historique** : chaque changement de statut (`ACTIVE`/`RETIREE`) est une
  nouvelle ligne ou un champ horodaté — jamais une réécriture silencieuse.

**Règle verrouillée** : `ShortlistEntree` (pool Admin-curé) ≠
`CandidateSelection` (choix Client pour entretien) ≠ `CandidateFinalDecision`
(§13) ≠ `Mission` (hors scope).

## 6. Interview Domain

- **Modèle** : `Interview` (voir §20). Référence `CandidateSelection`
  (jamais directement `ShortlistEntree`/`Profil`, pour garder la chaîne de
  responsabilité explicite).
- **Lifecycle proposé** (analysé, non imposé) : `PLANIFIE → CONFIRME →
  TERMINE | ANNULE | ABSENT`. `EN_COURS` est délibérément **omis** du
  schéma proposé : aucune intégration live n'existe pour le détecter
  automatiquement, et l'ajouter sans mécanisme de détection créerait un état
  jamais fiable — à réintroduire uniquement si une intégration temps réel
  est un jour construite.
- **Types RH/technique/client** : **non justifié aujourd'hui** — aucune
  donnée existante n'indique un besoin de taxonomie fermée. Proposition :
  un champ `objectif: String?` libre, jamais un enum fermé inventé sans
  preuve d'usage réel (même discipline que §12/§6 de l'audit précédent).
- **Plusieurs interviews par candidat** : oui — aucune contrainte
  d'unicité entre `Interview` et `CandidateSelection` (relation 1→N).
- **Plusieurs intervieweurs** : via plusieurs lignes `InterviewParticipant`
  avec `role: INTERVIEWEUR_TECHNIQUE`.
- **Répétition après absence/échec** : une **nouvelle** ligne `Interview`
  est créée référençant la même `CandidateSelection` — l'ancienne ligne
  `ABSENT`/`ANNULE` n'est jamais réutilisée ni mutée.
- **Canaux** : `VIDEO | TELEPHONE | PRESENTIEL | AUTRE` (enum fermé, donné
  explicitement par le mandat). Le métier ne dépend jamais d'un fournisseur
  vidéo — voir §13.

## 7. Scheduling + Participants

- **Champs `Interview`** : `dateHeure` (DateTime UTC), `dureeMinutes` (Int),
  `timezoneSaisie` (String, nom IANA — ex. "Europe/Paris", pour afficher
  l'heure localement à chaque participant sans ambiguïté), `canal`, `lieu`
  (String?, si PRESENTIEL).
- **`InterviewParticipant`** : `emailParticipant: String` (identifiant
  universel de l'acteur, **convention déjà établie** dans tout ATLAS —
  `createdByEmail`/`decideParEmail`/`valideParEmail` — jamais un nouveau
  mécanisme d'identité), `profilId: String?` (rempli uniquement si le
  participant est un `Profil` ATLAS — candidat ou intervieweur interne),
  `role: CANDIDAT | CLIENT | ADMIN_RECRUTEUR | INTERVIEWEUR_TECHNIQUE`,
  `estOrganisateur: Boolean` (exactement un `true` par `Interview`, même
  invariant que `MissionAssignment.estResponsablePrincipal` — à appliquer
  sous `Serializable` + retry `P2034`, voir §17).
- **Statut d'invitation par participant** (distinct du statut global de
  l'Interview) : `statutInvitation: ENVOYEE | ACCEPTEE | REFUSEE |
  EN_ATTENTE | CRENEAU_ALTERNATIF_PROPOSE`.

## 8. Email (obligatoire)

Réutilise le pattern `lib/email.ts` existant (best-effort, jamais bloquant),
étendu de nouveaux templates (conception uniquement, aucune fonction créée) :
`envoyerEmailInvitationEntretien` (objet, date/heure/timezone, durée, canal,
lien vidéo si renseigné, rôles des autres participants — **jamais leurs
coordonnées**, boutons Accepter/Refuser via lien à jeton signé non-connecté,
même principe que la vérification d'email existante), `envoyerEmailConfirmationEntretien`,
`envoyerEmailModificationEntretien`, `envoyerEmailAnnulationEntretien`,
`envoyerEmailRefusEntretien`.

Invariants explicitement respectés : **"Email envoyé ≠ accepté"**
(`statutInvitation` distingue `ENVOYEE` de `ACCEPTEE`) ; **"Accepté ≠
entretien réalisé"** (`statutInvitation: ACCEPTEE` n'implique jamais
`Interview.statut: TERMINE`, qui reste une constatation Admin après-coup).
L'acceptation/le refus sont persistés sur `InterviewParticipant`
(`statutInvitation`, `reponseLe`), jamais seulement un événement email
éphémère.

## 9. Calendar (obligatoire)

**EXTERNAL INTEGRATION**, séparée du domaine ATLAS (§17) : nouveau modèle
`CalendarSyncRecord` (un par `InterviewParticipant`, pas un par `Interview`,
puisque chaque participant a son propre calendrier). Flux : `Planification →
invitation → acceptation (statutInvitation: ACCEPTEE) → tentative de sync
calendrier (si une connexion future existe)`.

Champs : `provider` (String ouvert, aucun fournisseur choisi aujourd'hui —
"GOOGLE"/"MICROSOFT"/futur), `externalEventId: String?` (null jusqu'au
premier succès), `statutSync: NON_CONNECTE | EN_ATTENTE | SUCCES | ECHEC`,
`dernierEssaiLe`, `erreurDetail: String?`.

**Idempotence** : `@@unique([interviewParticipantId])` — une resynchronisation
mise à jour la ligne existante (et l'événement externe via `externalEventId`)
plutôt que de créer un doublon. Déplacement = update de l'événement externe
via le même `externalEventId`, jamais une recréation. Annulation = appel
d'annulation externe via `externalEventId` puis `statutSync` marqué
(nouvel état `ANNULE_EXTERNE`, jamais une suppression physique de la ligne
— historique conservé).

**Invariant absolu** : un `CalendarSyncRecord.statutSync: ECHEC` **n'invalide
jamais** l'`Interview` ATLAS — c'est une couche best-effort, exactement le
même principe déjà appliqué à l'email dans tout le reste du code.

## 10. Reminders (obligatoire)

Nouveau modèle dédié `InterviewReminder` (plutôt que d'étendre l'enum
`AttentionType` existant — séparation de domaine plus propre, § design
decision mineure, réversible) : `interviewParticipantId`, `delaiAvantMinutes`
(Int — ex. 1440 pour "24h", 60 pour "1h"), `statutEnvoi: PLANIFIE | ENVOYE |
ANNULE`, `envoyeLe: DateTime?`.

**Politique par défaut proposée : "24h + 1h"** — justification : 24h laisse
un délai suffisant pour reprogrammer en cas de conflit (réduit les
annulations tardives), 1h réduit le risque de no-show par oubli immédiat.
Politique configurable, pas verrouillée dans le code métier.

**Interdictions respectées par construction** : un job d'envoi de rappel
revérifie le statut de l'`Interview` **et** du `InterviewParticipant` **au
moment de l'envoi**, pas seulement à la création — un rappel dont
l'`Interview` est `ANNULE` ou dont `statutInvitation` est `REFUSEE` n'est
jamais envoyé (passe à `statutEnvoi: ANNULE`). Idempotent via
`@@unique([interviewParticipantId, delaiAvantMinutes])`. Un rescheduling
annule tous les rappels `PLANIFIE` existants et en crée de nouveaux pour la
nouvelle date — jamais une réutilisation de l'ancien enregistrement au-delà
de ce changement de statut.

## 11. Video Boundary

```
Interview (canal = VIDEO)
    ↓ (champs optionnels, jamais une dépendance dure)
meetingProvider: String? / meetingUrl: String? / meetingExternalId: String?
```

Aucune implémentation, aucun fournisseur imposé, aucun WebRTC. En V1
conceptuelle, `meetingUrl` peut être simplement saisi manuellement par
l'Admin (aucun appel API fournisseur requis) — l'automatisation via un vrai
`MeetingProvider` est une extension future indépendante. "InterviewRoom", si
construit un jour, ne représente que le contexte d'affichage ATLAS (date,
participants, lien cliquable) — jamais une infrastructure vidéo.

## 12. Evaluation

Nouveau modèle `InterviewEvaluation` — **Interview = événement,
Evaluation = résultat**, deux objets distincts (jamais fusionnés).

- `interviewId`, `evaluateurEmail` (même convention email-comme-identifiant).
- `observations: String` (texte libre qualitatif).
- `criteres: Json` — liste `{critere, observation, appreciation}` où
  `critere` provient d'un **petit vocabulaire fermé et documenté** (les
  mêmes facteurs que Matching V2 — compétences/séniorité/expérience/
  disponibilité — **plus** un petit set qualitatif non-technique
  ("communication", "motivation") **jamais** une nouvelle taxonomie de
  compétences techniques, conformément à §12 du mandat), `appreciation: POSITIF
  | NEUTRE | NEGATIF` (jamais un score numérique brut).
- `recommandation: RECOMMANDE | RECOMMANDE_AVEC_RESERVES | NON_RECOMMANDE`
  (qualitatif, global, jamais un pourcentage).
- `commentairesLibres: String?`.
- **Immutabilité** : une fois soumise, jamais modifiée — une correction crée
  une **nouvelle** ligne (`supersedesId`, même pattern que `FinancialResult`),
  jamais une réécriture en place.
- **"IA suggestion ≠ décision"** : si une synthèse IA est ajoutée un jour,
  elle doit apparaître dans un champ clairement distinct et jamais
  pré-remplir `recommandation` — invariant posé pour le futur, aucune IA
  n'est conçue ni implémentée ici.

## 13. Comparison + Final Decision

**Comparison** : vue de lecture pure (pas de nouveau modèle persisté
nécessaire — même pattern que `lib/client-solution/comparaison.ts`, qui
compare déjà des `SolutionOption` sans table dédiée). Agrège, par candidat
sélectionné : critères du besoin (`ClientNeedFait`), facteurs Matching V2,
`InterviewEvaluation`(s), disponibilité. **Ne génère jamais** un "meilleur
candidat" automatique — présente les faits côte à côte, point final.

**`CandidateFinalDecision`** (nouveau modèle, distinct de
`CandidateSelection`/Interview/Evaluation/Proposal/Mission) :
- `demandeTalentId`, `decideParEmail`.
- Lignes `CandidateFinalDecisionEntree` : `candidateSelectionId`, `statut:
  RETENU | NON_RETENU`, `justification: String?` (requise si `NON_RETENU`,
  même discipline que `REFUSER`/`DEMANDER_INFORMATIONS` dans
  Engineer Access & Trust).
- Append-only : une décision reconsidérée crée un nouvel enregistrement,
  jamais une réécriture.
- **Qui décide — DÉCISION CTO REQUISE (voir §27.4)** : proposition : CLIENT
  en autorité primaire (cohérent avec le principe "le Client décide" déjà
  répété dans les mandats précédents de ce programme), ADMIN en capacité de
  support/override (cohérent avec le rôle Admin général déjà établi
  ailleurs) — à confirmer explicitement étant donné la portée commerciale
  de cette décision.

## 14. RBAC / Tenant / Confidentiality

| Rôle | Candidate Review (anonyme) | Candidate Review (révélé) | Multi-sélection | Interview | Evaluation | Comparison | Final Decision |
|---|---|---|---|---|---|---|---|
| ADMIN | Voir | Voir/révéler | Agir pour le Client | Planifier/organiser | Évaluer | Voir | Décider (override) |
| CLIENT | Voir (sa demande) | Voir (après sélection) | Sélectionner | Voir, participer | Non (sauf si explicitement participant) | Voir | Décider (primaire) |
| INGENIEUR | — | — | — | Participer (si intervieweur technique interne) | Non | — | — |
| AGENT | Aucun accès direct, confirmé | — | — | — | — | — | — |

**Tenant isolation** : toutes les nouvelles routes scoped par
`DemandeTalent.clientId`/`session.clientId`, convention 403 (rôle/session)
/404 (autre tenant ou inexistant, jamais distingués) reconduite à
l'identique.

**IDOR** : aucune nouvelle route n'accepte un `profilId` candidat en entrée
— identité toujours résolue via `CandidateSelection`/`Interview` déjà
scopés au Client appelant, même discipline que l'existant.

**CV/coordonnées/données personnelles** : voir §4 (CV) et §18.

## 15. Audit

Réutilisation stricte de `journaliser()` — **aucun nouveau système d'audit**.
Actions proposées (états métier significatifs uniquement, pas de bruit) :
`candidate.selected`, `interview.created`, `interview.scheduled`,
`interview.invitation_sent`, `interview.accepted`, `interview.declined`,
`interview.rescheduled`, `interview.cancelled`, `interview.reminder_sent`,
`interview.completed`, `interview.evaluated`, `candidate.final_selected`,
`candidate.rejected`.

`candidate.detail_viewed` (révélation d'identité) est délibérément **non**
une entrée `journaliser()` — proposition : réutiliser l'événement de
sécurité générique déjà existant `objet.consultation`
(`lib/security/events.ts`), exactement comme il est déjà utilisé pour les
lectures sensibles (marge-intelligence, outcome) — pas une nouvelle entrée
de vocabulaire fermé, pas de bruit d'audit métier pour un simple événement
de lecture sensible.

## 16. Learning / Decision Context / RoleProfile compatibility

**Rien n'est modifié.** Points de raccordement futurs documentés
uniquement :
- `InterviewEvaluation → Learning` (A30) : une évaluation répétée
  négative/positive sur un type de profil pourrait un jour alimenter un
  `Learning` — lot futur, non conçu ici.
- `CandidateFinalDecision → Decision Context` (A36) : une future extension
  de `DecisionType` pourrait inclure ce point de décision — lot futur.
- Chaîne confirmée compatible : `RoleProfile → ClientNeed → DemandeTalent →
  Matching → Shortlist → Interview`. **`RoleProfile` n'entre jamais dans le
  scoring Matching V2**, invariant déjà verrouillé, reconduit ici sans
  changement.
- `Proposal` reste : **"Final Decision → Proposal"** — non construit, non
  conçu au-delà de cette confirmation.

## 17. Data Model

**ATLAS DOMAIN** (nouveaux modèles additifs, tous proposés, aucun créé) :

| Modèle | Responsabilité | Cardinalité clé | Mutabilité | Tenant | Audit |
|---|---|---|---|---|---|
| `CandidateSelection` | Choix Client d'un candidat pour entretien | 1 `ShortlistEntree` → N `CandidateSelection` (historique) | `statut` seul mutable | via `DemandeTalent.clientId` | `candidate.selected` |
| `Interview` | Événement d'entretien | 1 `CandidateSelection` → N `Interview` | `statut` mutable, reste immuable sinon | via `CandidateSelection` | `interview.*` |
| `InterviewParticipant` | Personne invitée à un Interview | 1 `Interview` → N `Participant` | `statutInvitation` mutable | via `Interview` | `interview.invitation_sent/accepted/declined` |
| `InterviewEvaluation` | Résultat qualitatif d'un Interview | 1 `Interview` → N `Evaluation` (1 par évaluateur, append-only) | Immuable (supersedesId) | via `Interview` | `interview.evaluated` |
| `CandidateFinalDecision`(+Entree) | Choix final parmi les candidats sélectionnés | 1 `DemandeTalent` → N `FinalDecision` (append-only) | Immuable | via `DemandeTalent.clientId` | `candidate.final_selected/rejected` |
| `InterviewReminder` | Planification des rappels | 1 `InterviewParticipant` → N `Reminder` (par politique) | `statutEnvoi` mutable | via `InterviewParticipant` | `interview.reminder_sent` |

**EXTERNAL INTEGRATIONS** :

| Modèle | Responsabilité | Découplage |
|---|---|---|
| `CalendarSyncRecord` | État de synchronisation calendrier externe | Un échec n'invalide jamais l'`Interview` (§9) |
| (Meeting Provider) | Champs optionnels sur `Interview` (`meetingProvider`/`meetingUrl`/`meetingExternalId`) | Pas de modèle dédié — champs nullable, aucun fournisseur imposé (§11) |

**`Serializable` + retry `P2034`**, pattern déjà établi
(`lib/mission/assignment.ts`, `lib/mission/capability-link.ts`), nécessaire
pour : création `CandidateSelection` (éviter doublon actif par candidat),
`InterviewParticipant.estOrganisateur` (exactement un par Interview),
`CandidateFinalDecision` (au plus une décision active par `DemandeTalent`).

## 18. Données personnelles

| Donnée | Accès | Nécessité | Conservation (conceptuelle) |
|---|---|---|---|
| Identité (nom/prénom) | Révélée au Client après sélection uniquement (§4) | Oui, pour organiser un entretien | Durée de la relation `DemandeTalent`/`Mission` |
| Email candidat | Via `Profil.compte→User.email` — Admin/système uniquement | Oui, pour l'invitation | Idem |
| **Téléphone** | **GAP confirmé** : `Profil` n'a aujourd'hui aucun champ téléphone pour un Talent (contrairement à `Client`). Proposition non-bloquante : si un entretien `TELEPHONE` nécessite un numéro, le capturer en texte libre **sur `InterviewParticipant`**, scopé à cet entretien, jamais sur `Profil` (évite toute modification de schéma existant). | Conditionnelle | Scope strictement à l'Interview |
| CV | Admin uniquement, jamais exposé au Client (§4, décision à confirmer) | Oui pour l'Admin | Déjà géré par l'existant, non concerné |
| Notes d'évaluation | Admin/évaluateur ; jamais le candidat lui-même | Oui | Immuable, conservée (append-only) |
| Vidéo | **Jamais stockée par défaut** — aucun enregistrement conçu | — | N/A |
| Données calendaires externes | Seul `externalEventId` + statut stockés, **jamais le contenu complet de l'événement externe miroir** | Minimal | Jusqu'à annulation/désynchronisation |
| Identifiants externes (meeting/calendar) | Techniques uniquement | Minimal | Jusqu'à fin de vie de l'Interview |

## 19. UX Architecture

Parcours conceptuel, écran par écran, principes "Clarté → hiérarchie →
efficacité → densité maîtrisée → confiance → traçabilité" appliqués à
chacun :

1. **Shortlist (projection Client)** : liste simple des `ShortlistEntree`
   VALIDEE, anonymisée — clarté (une carte = un candidat, rien de superflu).
2. **Candidate Review (anonyme)** : réutilise le pattern `CandidatCard`
   existant (`app/client/talent/page.tsx`) — hiérarchie (explication en
   premier, détails ensuite), densité maîtrisée (pas de surcharge visuelle).
3. **Candidate Review (détaillé, post-sélection)** : nouvelle page dédiée
   (jamais une modale — le système de composants client (`components/client/primitives.tsx`)
   n'a volontairement aucun Modal/Dialog ; rester cohérent avec cette
   absence délibérée plutôt que d'en introduire un).
4. **Multi-selection** : cases à cocher sur les cartes existantes + un
   bouton d'action explicite ("Sélectionner pour entretien") — efficacité
   (une action, un résultat visible immédiatement).
5. **Scheduling/Invitation/Acceptation** : formulaire Admin de
   planification + statuts d'invitation affichés en badges clairs
   (ENVOYEE/ACCEPTEE/REFUSEE) — confiance (statut toujours visible, jamais
   ambigu).
6. **Calendrier/Rappels** : indicateurs passifs (icône de statut de sync,
   pas d'interaction requise de l'utilisateur) — densité maîtrisée.
7. **Interview (détail)** : page simple date/heure/participants/lien —
   aucune UI "room" complexe.
8. **Evaluation** : formulaire court (critères fermés + texte libre +
   recommandation qualitative) — traçabilité (toujours daté/attribué,
   jamais modifiable après coup, affiché comme tel).
9. **Comparison** : tableau, réutilisant l'esthétique déjà employée par
   `SolutionsBesoin.tsx` pour comparer des options — confiance (les
   mêmes faits, jamais un verdict imposé par l'écran).
10. **Final Decision** : action explicite "Retenir"/"Non retenu" avec
    justification requise au rejet, même pattern UX que
    `deciderSolution()`/"Choisir cette solution" déjà en production.

**Composants/tokens** : aucun nouveau token créé. Le Client UI actuel
n'utilise pas de système de tokens formel (styles inline majoritairement) —
cette conception reste cohérente avec cet état existant plutôt que
d'introduire un système parallèle à l'occasion de ce lot.

## 20. Accessibility / Responsive

WCAG AA comme base (contraste des badges de statut, labels ARIA sur les
cases de sélection, ordre de focus logique dans les formulaires
Evaluation/Scheduling, jamais une information uniquement portée par la
couleur — ex. statut d'invitation toujours accompagné d'un texte, pas
seulement une pastille colorée). Desktop/tablette : tableaux
(Comparison) en grille classique. Mobile : les tableaux de comparaison et
les listes de candidats se replient en cartes empilées, suivant le pattern
déjà utilisé ailleurs dans les pages Client existantes.

## 21. Risks

1. **Révélation d'identité prématurée** si le seuil proposé (§4/§27.1)
   n'est pas respecté dans l'implémentation future — risque de
   confidentialité réel, à verrouiller précisément dans le contrat API
   futur.
2. **Nouvelle surface de lecture sur `ShortlistEntree`** (§5/§27.3) change
   une frontière de visibilité jusqu'ici strictement interne — risque
   produit/commercial si mal calibré (ex. exposer un candidat REJETEE par
   erreur de filtre).
3. **Absence de champ téléphone candidat** (§18) : un canal `TELEPHONE`
   mal conçu pourrait inciter à ajouter ce champ sur `Profil` sans réflexion
   — la solution proposée (champ scopé à l'Interview) évite ce risque si
   elle est bien respectée à l'implémentation.
4. **Famille des 6 modules "Intelligence"** (dette déjà documentée, §22) :
   toute future intégration de l'Evaluation/Comparison avec cette famille
   sans audit préalable ligne par ligne risque d'ajouter une 7ᵉ couche
   redondante.
5. **Échec calendrier perçu comme un échec métier** si l'UI future ne
   distingue pas clairement `CalendarSyncRecord.statutSync: ECHEC` d'un
   problème de l'`Interview` elle-même — risque UX, pas architectural.

## 22. CTO Decisions (déjà listées in-ligne, récapitulatif)

Voir §27 pour le détail complet des 7 décisions. Aucune ne bloque ce
document — chacune a une recommandation par défaut.

## 23. Implementation Sequence (indicative, non engageante)

```
1. CandidateSelection + nouvelle surface de lecture Client sur ShortlistEntree(VALIDEE)
2. Candidate Review détaillé (révélation nom/prénom seule, post-sélection)
3. Interview + InterviewParticipant + email (invitation/confirmation/annulation/refus)
4. CalendarSyncRecord (intégration future, peut être différée sans bloquer 1-3)
5. InterviewReminder
6. InterviewEvaluation
7. Comparison (vue de lecture pure)
8. CandidateFinalDecision
```

## 24. Explicit Non-Goals

Aucun nouveau Staffing, aucun nouveau moteur de matching/scoring, aucun
Proposal, aucun WebRTC, aucun calendrier propriétaire, aucune intégration
réelle Teams/Meet/Google/Outlook, aucun nouveau système RBAC/audit,
aucune modification de `Matching V2`/`DemandeTalent`/`ShortlistEntree`/
`Mission`/`Learning`/Decision Context, aucune nouvelle taxonomie de
compétences, aucun score opaque, aucune décision automatique IA.

## 25. Test Contract (futur, non créé)

| Catégorie | Doit prouver | Exemple de scénario |
|---|---|---|
| RBAC | Seuls les rôles autorisés agissent à chaque étape | INGENIEUR ne peut pas créer de `CandidateSelection` |
| Tenant/IDOR | Aucune fuite cross-client | Client A ne peut jamais voir la Shortlist de Client B |
| Confidentialité | Identité jamais révélée avant sélection | `CandidatAnonyme` reste anonyme tant que non sélectionné |
| Lifecycle Interview | Transitions valides uniquement | `ANNULE → TERMINE` impossible |
| Multi-sélection | Sélection/retrait cohérents | Retirer une sélection ne supprime pas l'historique |
| Final Decision | Une seule décision active, append-only | Reconsidérer crée une nouvelle ligne, pas une réécriture |
| Évaluations | Immutabilité | Modifier une évaluation crée une nouvelle ligne (`supersedesId`) |
| Annulation/Absence/Répétition | Pas de réutilisation d'une ligne terminée | Un nouvel `Interview` est créé après `ABSENT` |
| Email | Best-effort, jamais bloquant | Échec d'envoi n'empêche pas la création de l'Interview |
| Acceptation/Refus | Persistance correcte | `statutInvitation` reflète exactement la dernière réponse |
| Rappels | Idempotence, pas de doublon, pas après annulation | Annuler un Interview annule ses rappels `PLANIFIE` |
| Rescheduling | Anciens rappels annulés, nouveaux créés | Pas de rappel fantôme sur l'ancienne date |
| Calendrier | Idempotence, pas de doublon d'événement externe | Une resynchronisation met à jour, ne duplique jamais |
| Erreurs fournisseur | N'invalident jamais l'Interview | `statutSync: ECHEC` n'empêche pas `Interview.statut: CONFIRME` |

## 26. Dettes existantes (documentées, non corrigées dans ce lot)

1. `DemandeTalent.statut` : `SHORTLIST_ENVOYEE`/`CLOTUREE` structurellement
   inatteignables (aucune route ne les écrit jamais).
2. Création de `Mission` depuis une `DemandeTalent` : non auditée en cas de
   succès (seul l'échec RBAC l'est).
3. Famille des 6 modules "Intelligence" (candidate/talent/trust/
   recommendation/mission/foundation) : à auditer ligne par ligne avant
   toute extension future du scoring/de l'explication candidat.

## 27. CTO Decisions Required (détail complet)

1. **Seuil de révélation d'identité** — proposition : à l'entrée en
   `CandidateSelection` (pas avant). Alternative : au moment de la
   planification d'Interview (seuil plus tardif). Recommandation : la
   proposition, pour cohérence avec le principe déjà établi ailleurs
   (révélation = preuve d'engagement réel).
2. **Exposition du CV au Client** — proposition : jamais, même après
   sélection/entretien. Alternative : exposer après `CandidateFinalDecision`
   uniquement. Recommandation : la proposition (défaut le plus restrictif,
   réversible).
3. **Nouvelle surface de lecture Client sur `ShortlistEntree`** —
   proposition : oui, filtrée strictement à `VALIDEE`, additive, modèle
   inchangé. Alternative : l'Admin curate manuellement une liste séparée
   avant toute visibilité Client (plus de contrôle, plus de friction
   opérationnelle). Recommandation : la proposition, avec revue de sécurité
   dédiée au moment de l'implémentation (risque réel, §21.2).
4. **Autorité de la Final Decision** — proposition : CLIENT primaire, ADMIN
   en override de support. Alternative : ADMIN seul décideur formel (le
   Client "recommande" seulement). Recommandation : la proposition,
   cohérente avec "le Client décide" déjà répété dans ce programme — mais
   la portée commerciale justifie une confirmation explicite.
5. **Canal TELEPHONE sans champ `Profil.telephone`** — proposition :
   capturer le numéro en texte libre scopé à `InterviewParticipant`, jamais
   sur `Profil`. Alternative : ajouter `Profil.telephone` (modification de
   schéma, hors scope de ce lot). Recommandation : la proposition (non
   bloquante, zéro impact sur le schéma existant).
6. **Infrastructure de rappel** — proposition : modèle dédié
   `InterviewReminder`. Alternative : étendre l'enum `AttentionType`
   existant. Recommandation : la proposition (séparation de domaine plus
   propre ; `Attention` reste disponible en complément pour une alerte
   in-app, sans en dépendre).
7. **Taxonomie de type d'Interview** — proposition : champ texte libre
   `objectif`, pas d'enum RH/technique/client. Recommandation : la
   proposition (aucune preuve d'usage réel ne justifie un enum fermé
   aujourd'hui).

Aucune de ces sept décisions ne constitue une ambiguïté architecturale
bloquante au sens strict — chacune a une recommandation par défaut
justifiée et réversible qui permet à ce contrat d'être complet.

## 28. Verdict

Toutes les sections sont renseignées avec des recommandations justifiées.
Aucune décision architecturale critique n'est restée sans proposition.

---

**CANDIDATE DECISION + INTERVIEW — DESIGN CONTRACT COMPLETE / READY FOR CTO VALIDATION**

Après ce document : STOP. Aucun lot suivant commencé.
