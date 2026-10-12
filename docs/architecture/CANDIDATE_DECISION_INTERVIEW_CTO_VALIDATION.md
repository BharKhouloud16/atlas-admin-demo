# ATLAS — CANDIDATE DECISION + INTERVIEW — CTO VALIDATION

Document de validation uniquement. Aucun code, migration, API, UI,
composant, service, provider, système RBAC ou audit n'a été créé ou modifié
pour produire ce document. Aucune dette existante n'a été corrigée.

Méthode : chaque affirmation du Design Contract a été re-vérifiée contre les
faits réels du dépôt (schéma, routes, services) déjà établis par les deux
audits précédents (`COMMERCIAL_TALENT_FLOW_EXISTING_AUDIT.md`,
`COMMERCIAL_FOUNDATION_DESIGN_CONTRACT.md`) — jamais acceptée comme vraie
simplement parce qu'elle figure dans le Design Contract. Les distinctions
suivantes sont tenues tout au long du document :

- **FAIT EXISTANT** = vérifié dans le code réel.
- **DÉCISION ATLAS DÉJÀ VERROUILLÉE** = actée dans un lot précédent de ce
  programme (ex. Staffing V1 = `DemandeTalent`).
- **PROPOSITION (Design Contract)** = une recommandation, pas une vérité.
- **NOUVELLE DÉCISION CTO** = tranchée dans ce document, ici, pour la
  première fois.

---

## 1. Executive CTO Verdict

Le Design Contract est **globalement solide et correctement grounded** dans
l'existant réel. Sur les 7 décisions soumises : **6 APPROVED, 1 MODIFIED**
(autorité de la Final Decision, §13). Deux clarifications supplémentaires,
non identifiées comme décisions explicites dans le Design Contract mais
découvertes à cette relecture critique, sont tranchées ici (§7, rôle
"intervieweur technique" ; §7, critère exact de `CONFIRME`). Aucun blocker
ne subsiste. **Le lot d'implémentation peut démarrer**, sous réserve des
conditions explicites posées en §21.

## 2. Existing Facts Verified

Re-vérifiés contre le code réel (pas seulement contre le Design Contract) :

| Fait | Statut |
|---|---|
| `ShortlistEntree` est 100% Admin-only (2 seuls points d'appel Prisma, tous deux gated `role !== "ADMIN"`) | FAIT EXISTANT, confirmé |
| `CandidatAnonyme` = 9 champs exacts, `ingenieurId` = HMAC via `idPublicIngenieur` | FAIT EXISTANT, confirmé |
| `GET /api/client/missions` révèle `nom`/`prenom` seulement une fois une Mission existe | FAIT EXISTANT, confirmé |
| `Profil` n'a aucun champ téléphone | FAIT EXISTANT, confirmé |
| `DemandeTalent.statut` : `SHORTLIST_ENVOYEE`/`CLOTUREE` structurellement inatteignables | FAIT EXISTANT, confirmé |
| `AttentionType` n'a aucune valeur liée à l'entretien | FAIT EXISTANT, confirmé |
| `FinancialResult.supersedesId` = pattern append-only déjà en production | FAIT EXISTANT, confirmé |
| `MissionAssignment.estResponsablePrincipal` = pattern "exactement un par parent" déjà en production, sous `Serializable`+retry | FAIT EXISTANT, confirmé |
| `deciderSolution()`/`SolutionOption(DECISION)` est **exclusivement Client**, **aucune route Admin équivalente n'existe** | FAIT EXISTANT, **nouvellement vérifié à cette relecture — contredit une hypothèse implicite du Design Contract, voir §13** |
| Staffing V1 = `DemandeTalent` (ne pas créer de nouveau modèle) | DÉCISION ATLAS DÉJÀ VERROUILLÉE |
| RoleProfile n'entre jamais dans le scoring Matching V2 | DÉCISION ATLAS DÉJÀ VERROUILLÉE |

Le point nouvellement vérifié (ligne 9) est significatif : le Design
Contract justifiait l'option "ADMIN en override" de la Final Decision par
analogie avec "le rôle Admin général déjà établi ailleurs" — **cette
analogie ne résiste pas à la vérification** : le seul précédent réel de
décision commerciale comparable (`deciderSolution`) n'a **aucune** voie
Admin équivalente. Voir §13 pour la conséquence sur la décision 4.

## 3. Decision Matrix — 7 decisions

| # | Décision | Verdict |
|---|---|---|
| 1 | Seuil de révélation d'identité = à l'entrée en `CandidateSelection` | **APPROVED** |
| 2 | CV jamais exposé au Client (dans ce lot) | **APPROVED** (précisé §6) |
| 3 | Nouvelle surface de lecture Client sur `ShortlistEntree(VALIDEE)` | **APPROVED** (conditions §5/§21) |
| 4 | Autorité Final Decision : CLIENT primaire, ADMIN override | **MODIFIED** (§13) |
| 5 | Téléphone candidat scopé à `InterviewParticipant`, jamais sur `Profil` | **APPROVED** |
| 6 | `InterviewReminder` dédié plutôt qu'extension d'`AttentionType` | **APPROVED** |
| 7 | Pas de taxonomie fermée de type d'Interview (`objectif` libre) | **APPROVED** |

## 4. Identity / Confidentiality Decision

**Problème** : à quel moment l'identité réelle d'un candidat peut-elle être
révélée à un Client, et jusqu'où ?

**Recommandation proposée** : révélation (nom/prénom uniquement) à l'entrée
en `CandidateSelection`, jamais avant.

**Conséquences produit** : le Client ne peut influencer son choix par un
biais lié au nom (ethnicité/genre perçus) avant d'avoir évalué le candidat
sur les faits de matching — un bénéfice anti-discrimination réel, non
explicité dans le Design Contract mais qui renforce la décision.

**Conséquences sécurité/confidentialité** : seuil cohérent avec le seul
précédent réel du dépôt (`GET /api/client/missions`, révélation seulement
après engagement réel). Aucune route ne doit accepter de `profilId` en
entrée — confirmé déjà respecté dans la conception.

**Conséquences techniques** : aucune — additive, pas de modification de
`Profil`/`idPublicIngenieur`.

**Conséquences futures** : compatible avec `CandidateFinalDecision` et un
futur `Proposal`.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.** Le seuil
"CandidateSelection" est verrouillé. Toute révélation d'identité plus large
(email, téléphone, CV) reste interdite au Client à ce stade — seul l'ADMIN y
accède, pour organiser l'entretien.

**Pourquoi** : c'est le seul seuil qui ne contredit aucun fait existant et
qui renforce, plutôt qu'affaiblit, la discipline de confidentialité déjà en
place.

## 5. ShortlistEntree Access Decision

**Problème** : `ShortlistEntree` est aujourd'hui 100% interne. Le parcours
cible exige que le Client voie une shortlist pour sélectionner.

**Recommandation proposée** : nouvelle route de lecture Client, filtrée
strictement à `statut: VALIDEE`, modèle `ShortlistEntree` inchangé.

**Conséquences produit** : seule option qui ne force pas l'Admin à
dupliquer manuellement les données validées dans un second objet (ce que
l'alternative — "l'Admin curate une liste séparée" — impliquerait de facto,
créant un risque de dérive entre les deux copies).

**Conséquences sécurité/confidentialité** : risque réel et déjà identifié
(§21.2 du Design Contract) — une erreur de filtre pourrait exposer une
entrée `REJETEE`/`SUGGEREE`. `score`/`confiance`/`motifs` (`ShortlistEntree.motifs`)
ne doivent **jamais** apparaître dans cette nouvelle route — seuls les
champs déjà jugés sûrs pour `CandidatAnonyme` (ou l'identité révélée post-
sélection) sont exposables.

**Conséquences techniques** : additive, aucune migration sur
`ShortlistEntree`.

**Conséquences futures** : compatible, n'engage aucune dépendance vers
Proposal/Mission.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED, sous conditions contraignantes
pour le futur Implementation Contract** (non négociables, pas optionnelles) :
1. Le filtre `statut: VALIDEE` doit être appliqué **dans la clause Prisma
   `where`**, jamais en post-filtrage applicatif.
2. `score`/`confiance`/`motifs` ne sont **jamais** sérialisés dans la
   réponse de cette route.
3. Un test dédié de non-fuite (`REJETEE`/`SUGGEREE` jamais retournés même
   par manipulation de paramètres) est un **prérequis au merge**, pas un
   test parmi d'autres.

**Pourquoi** : la frontière de visibilité change réellement (§21.2 du
Design Contract l'identifie déjà comme un risque) — l'approbation est
conditionnée, pas inconditionnelle.

## 6. CandidateSelection Decision

**Problème** : distinguer shortlisté / sélectionné pour entretien / retenu
/ choisi finalement, sans doublonner `DemandeTalent`/`ShortlistEntree`.

**Analyse** : la chaîne proposée (`ShortlistEntree(VALIDEE)` → `CandidateSelection`
→ `Interview`/`InterviewEvaluation` → `CandidateFinalDecision`) est
**correctement non-redondante** — chaque objet a une responsabilité unique
et non chevauchante, vérifiée ligne par ligne contre l'audit existant :
`ShortlistEntree` reste le pool curé par l'Admin (inchangé) ;
`CandidateSelection` est strictement un nouveau fait ("le Client veut
avancer avec ce candidat"), qui n'existe sous aucune forme aujourd'hui.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.**
`CandidateSelection` n'est pas un doublon — c'est le seul point du parcours
actuel qui manquait réellement (confirmé par l'audit : aucune sélection,
simple ou multiple, n'existe aujourd'hui côté Client).

**CV (rappel décision 2)** : confirmé **APPROVED**, avec la précision
suivante, absente du Design Contract et ajoutée ici : la restriction "CV
jamais exposé au Client" s'applique **à ce lot**, pas de façon permanente —
le point de bascule naturel (post-`Proposal`/acceptation commerciale) est
explicitement hors scope ici et devra être retranché au moment du design du
Proposal, pas supposé résolu par défaut à ce stade.

## 7. Interview Decision

**Problème** : objet métier Interview, lifecycle, types, participants,
rescheduling, cancellation, indépendance vis-à-vis d'un fournisseur vidéo.

**Lifecycle `PLANIFIE → CONFIRME → TERMINE | ANNULE | ABSENT`** :
**APPROVED**, avec une précision manquante dans le Design Contract, ajoutée
ici comme **NOUVELLE DÉCISION CTO** : `CONFIRME` exige que **tous** les
participants dont `role` est `CANDIDAT` ou `estOrganisateur: true` aient
`statutInvitation: ACCEPTEE` — pas une majorité, pas "au moins le candidat
seul". Un `InterviewParticipant` secondaire (ex. un deuxième intervenant)
qui refuse ne fait **pas** automatiquement basculer l'`Interview` en
`ANNULE` — seul le refus du `CANDIDAT` ou de l'organisateur déclenche cette
transition automatique ; un refus d'un participant secondaire reste un
`statutInvitation: REFUSEE` localisé, à traiter par décision Admin manuelle
(remplacer le participant ou poursuivre sans lui).

**Types RH/technique/client (`objectif` libre, pas d'enum)** : **APPROVED**,
décision 7 confirmée (§11).

**Rôle "intervieweur technique" (`InterviewParticipant.role`)** —
**CLARIFICATION REQUISE, résolue ici comme NOUVELLE DÉCISION CTO** : le
Design Contract liste `CANDIDAT | CLIENT | ADMIN_RECRUTEUR |
INTERVIEWEUR_TECHNIQUE` sans préciser si "intervieweur technique" désigne
un représentant **du Client** (un lead technique côté Client évaluant le
candidat) ou un acteur **interne ATLAS**. Aucun précédent dans le dépôt ne
tranche cette ambiguïté (aucun rôle "intervieweur" n'existe nulle part
ailleurs). **Décision** : "intervieweur technique" est un **sous-rôle du
représentant du Client**, pas un acteur ATLAS distinct — `role: CLIENT`
reste la valeur d'enum, avec un champ complémentaire optionnel
`fonctionDeclaree: String?` (texte libre, ex. "Lead technique") plutôt
qu'une 5ᵉ valeur d'enum. Justification : aucune donnée réelle ne prouve
qu'ATLAS a besoin de distinguer formellement ces deux rôles aujourd'hui —
créer une 5ᵉ valeur d'enum sans preuve d'usage violerait la même discipline
déjà appliquée ailleurs ("ne pas inventer de taxonomie sans donnée réelle").
Un intervieweur **technique interne ATLAS** (si jamais nécessaire) reste
couvert par `ADMIN_RECRUTEUR` avec le même champ `fonctionDeclaree`.

**Plusieurs interviews, plusieurs intervieweurs, répétition après
absence** : **APPROVED sans modification** — correctement non-redondant,
append-only, vérifié cohérent avec le reste du dépôt (même discipline que
`MissionCapabilityLink`/`ShortlistEntree`).

**Indépendance vis-à-vis du fournisseur vidéo** : **APPROVED** — voir §14.

## 8. Email Decision

**Problème** : invitation, confirmation, refus, modification, annulation,
rappel.

**Analyse** : le Design Contract pose correctement "Email envoyé ≠
accepté" et "Accepté ≠ entretien réalisé" comme deux invariants distincts,
chacun porté par un champ persistant distinct (`InterviewParticipant.statutInvitation`
vs `Interview.statut`) — vérifié cohérent, aucune confusion entre les deux
axes.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.** Les emails
restent des notifications d'intégration (best-effort, jamais bloquantes,
même discipline que `lib/email.ts` existant) — jamais la source de vérité
métier, qui reste exclusivement `InterviewParticipant.statutInvitation` et
`Interview.statut`.

## 9. Calendar Decision

**Problème métier imposé** : *"Après acceptation d'une invitation,
l'interview doit être automatiquement ajoutée au calendrier du participant
lorsque l'intégration est disponible."*

**Analyse** : le modèle `CalendarSyncRecord` (un par `InterviewParticipant`,
déclenché sur `statutInvitation: ACCEPTEE`) satisfait exactement cette
règle. Idempotence vérifiée correcte : `@@unique([interviewParticipantId])`
+ réutilisation de `externalEventId` pour update/annulation (jamais une
recréation) — pattern conceptuellement équivalent à l'idempotence déjà
exigée ailleurs dans ATLAS (`@@unique` sur les clés naturelles, ex.
`CapabilityRequirement.@@unique([needVersionId, sourceFaitId])`).

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification**, invariant
confirmé et renforcé : `CalendarSyncRecord.statutSync: ECHEC` n'invalide
**jamais** l'`Interview` — même discipline que l'email, déjà la norme ATLAS
pour toute intégration externe best-effort (ex. `supprimerFichier` dans
`lib/storage.ts` : échec best-effort, jamais bloquant).

## 10. Reminder Decision

**Problème** : politique de rappel, timing, idempotence, annulation.

**Politique "24h + 1h"** : **APPROVED**, justification jugée suffisante
(délai de reprogrammation + réduction du no-show), explicitement
configurable (pas verrouillée dans le code métier) — correct, pas une
règle arbitraire figée.

**Analyse technique** : revérification du statut **au moment de l'envoi**
(pas seulement à la création) est la bonne discipline — empêche l'envoi
d'un rappel orphelin après annulation/refus. Idempotence via
`@@unique([interviewParticipantId, delaiAvantMinutes])` correcte. Annulation
automatique des rappels `PLANIFIE` lors d'un rescheduling, sans réutilisation
de l'ancien enregistrement — append-only cohérent avec le reste d'ATLAS.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.** `InterviewReminder`
dédié (décision 6) confirmé — `Attention` reste disponible en complément
pur in-app, jamais une dépendance.

## 11. Evaluation Decision

**Problème** : observation humaine qualitative, append-only, jamais une
décision automatique.

**Analyse** : les critères proposés (`criteres: Json`, vocabulaire fermé
réutilisant les facteurs Matching V2 + un petit set qualitatif
"communication"/"motivation") respectent correctement l'interdiction de
créer une nouvelle taxonomie de compétences techniques. `appreciation`
(POSITIF/NEUTRE/NEGATIF) et `recommandation` (RECOMMANDE/
RECOMMANDE_AVEC_RESERVES/NON_RECOMMANDE) sont tous deux qualitatifs — aucun
score numérique brut, conforme.

**Qui évalue** : le Design Contract ne le précise pas explicitement au-delà
d'`evaluateurEmail` — **NOUVELLE DÉCISION CTO** : seuls `ADMIN` et
`INTERVIEWEUR_TECHNIQUE`/`fonctionDeclaree` (participant ayant réellement
assisté à l'`Interview`, vérifié via `InterviewParticipant.statutInvitation: ACCEPTEE`
sur cet `Interview`) peuvent soumettre une `InterviewEvaluation`. Le
**CLIENT en tant que simple participant** peut évaluer (il a assisté), mais
**jamais un Client qui n'a pas participé à cet Interview précis** — garde-
fou simple, dérivé directement de la présence effective, jamais une
permission globale.

**Visibilité Client/Admin** : **NOUVELLE DÉCISION CTO** — une
`InterviewEvaluation` soumise par un participant CLIENT est visible par cet
même Client et par l'Admin ; une évaluation soumise par un
`INTERVIEWEUR_TECHNIQUE`/Admin reste **Admin-only** par défaut (même
discipline de confidentialité interne déjà appliquée à
`ShortlistEntree.motifs`) sauf si explicitement partagée — pas de
visibilité croisée automatique entre évaluateurs.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED, avec les deux précisions
ci-dessus actées comme faisant partie du contrat.** Immutabilité
(`supersedesId`) confirmée correcte. "IA suggestion ≠ décision" reste un
invariant pour un lot futur, non implémenté ici — confirmé, rien à ajouter.

## 12. Comparison Decision

**Problème** : comparer plusieurs candidats sans nouveau moteur de
matching, sans score opaque, sans vérité automatique.

**Analyse** : la Comparison proposée est une **vue de lecture pure**,
jamais un modèle persisté — vérifiée cohérente avec le seul précédent réel
du dépôt (`lib/client-solution/comparaison.ts::comparerOptions`, qui
compare déjà des `SolutionOption` sans table dédiée). Elle agrège des faits
déjà existants (`ClientNeedFait`, facteurs Matching V2, `InterviewEvaluation`)
sans jamais recalculer un score ni déclarer un "meilleur candidat" —
conforme à l'exigence explicite.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.** Aucun
nouveau modèle requis pour la Comparison — confirmé.

## 13. Final Decision

**Problème** : qui décide, sur quels candidats, quelles décisions, lien
avec Proposal/Mission futurs.

**MODIFICATION par rapport à la proposition du Design Contract** : la
proposition originale ("CLIENT primaire, ADMIN en override") s'appuyait sur
une analogie ("cohérent avec le rôle Admin général") qui **ne résiste pas à
la vérification** (§2) : le seul précédent réel de décision commerciale
comparable, `deciderSolution()`/`SolutionOption(DECISION)`, est
**exclusivement Client**, sans aucune route Admin équivalente dans tout le
dépôt. Accorder à l'Admin un pouvoir de décision indépendant sur un choix
d'embauche-adjacent serait une extension de pouvoir RBAC **sans fondement
réel** dans l'existant — exactement le type de dérive silencieuse que ce
programme interdit explicitement depuis le premier mandat Commercial.

**DÉCISION ATLAS DÉFINITIVE (MODIFIED)** : `CandidateFinalDecision` est
**exclusivement décidée par le CLIENT**. L'ADMIN **n'a pas** de pouvoir de
décision indépendant. L'ADMIN peut **enregistrer** une décision
communiquée par le Client via un canal hors-système (téléphone, email) —
mais uniquement comme un acte de saisie, jamais de jugement propre, et
**obligatoirement** avec un champ `communiqueParClientHorsSysteme: Boolean`
+ `canalHorsSysteme: String?` renseignés, pour que la ligne reste
honnêtement traçable comme "saisie pour le compte du Client", jamais comme
une décision Admin autonome. Ceci reproduit le pattern déjà existant de
`app/admin/demandes/page.tsx` (Admin marque "traité" une action réalisée
hors système, jamais une décision Admin de fond).

**Pourquoi** : préserve "le Client décide" sans bloquer la flexibilité
opérationnelle réelle (un Client qui appelle plutôt que de cliquer dans
l'UI) — et évite d'introduire, sans aucune preuve que c'est nécessaire, une
capacité de décision Admin qui n'existe nulle part ailleurs dans ATLAS pour
ce type d'action.

**Relation avec Proposal/Mission** : confirmé — `CandidateFinalDecision`
**ne crée jamais** directement une `Mission` dans ce lot. "Final Decision →
Proposal" reste la seule chaîne documentée, Proposal restant un objet futur
séparé, non conçu ici.

## 14. Video Boundary

**Problème** : garantir `Interview ATLAS → Video integration`, jamais
l'inverse.

**Analyse** : les champs proposés (`meetingProvider`/`meetingUrl`/
`meetingExternalId`, tous optionnels sur `Interview`) respectent
correctement cette direction — aucune donnée métier (lifecycle, participants,
évaluation) ne dépend de la présence ou de la validité de ces champs.
"InterviewRoom" est explicitement cantonné à un contexte d'affichage, jamais
une infrastructure — confirmé correct, aucune ambiguïté résiduelle.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.** ATLAS reste
propriétaire du contexte métier ; aucun fournisseur n'est imposé ni même
nommé en dur.

## 15. RBAC / Tenant / IDOR

Vérification complète du tableau RBAC du Design Contract (§14) contre
l'existant :

| Rôle | Vérification |
|---|---|
| ADMIN | Gouvernance complète confirmée cohérente avec son rôle existant (curation `ShortlistEntree`, organisation) — **sauf** Final Decision, corrigé §13 |
| CLIENT | Accès limité à sa propre `DemandeTalent`/`CandidateSelection`/`Interview` — confirmé scoped par `clientId`, même discipline que l'existant |
| INGENIEUR | Aucun nouveau pouvoir commercial — confirmé, seule capacité : participer comme `InterviewParticipant` si techniquement concerné (lecture seule de son propre engagement, jamais un accès commercial) |
| AGENT | Aucune identité métier directe, aucune décision — confirmé, cohérent avec la règle déjà établie dans Engineer Access & Trust ("aucune identité Agent n'a jamais d'accès direct à une mutation commerciale") |

**Tenant isolation / IDOR** : confirmé correct — toute nouvelle route scoped
par `DemandeTalent.clientId`/`session.clientId`, jamais un `profilId`
candidat accepté en entrée, convention 403/404 reconduite à l'identique.
Accès aux calendriers/liens vidéo : strictement scoped au participant
propriétaire (`InterviewParticipant.emailParticipant`), jamais une donnée
partagée entre participants d'un même `Interview`.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED avec la correction de §13
intégrée.**

## 16. Audit

Vérifié : `journaliser()` réutilisé, aucun nouveau système. La liste
d'actions proposée (§15 du Design Contract) est confirmée non-redondante et
suffisante pour les transitions métier significatives. La décision de
réutiliser `objet.consultation` (événement de sécurité déjà existant) pour
`candidate.detail_viewed` plutôt que de créer une entrée `journaliser()` est
**confirmée correcte** — cohérent avec l'usage déjà établi pour les
lectures sensibles (marge-intelligence, outcome).

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification**, avec un
ajout : les deux actions introduites par §13 (enregistrement Admin d'une
décision communiquée hors système) doivent utiliser la **même** action
`candidate.final_selected`/`candidate.rejected`, jamais une action distincte
— le canal (Client via UI vs Admin pour compte du Client) est capturé par le
champ `communiqueParClientHorsSysteme`, pas par une action d'audit séparée
(évite la prolifération de vocabulaire).

## 17. Seven-object Boundary

| Objet | Raison d'exister | Doublon d'un objet existant ? |
|---|---|---|
| `CandidateSelection` | Seul objet qui manquait réellement — aucune sélection n'existe aujourd'hui | Non, confirmé §6 |
| `Interview` | Domaine entièrement absent (niveau 0, confirmé par l'audit) | Non |
| `InterviewParticipant` | Multi-participants, rôles, statuts d'invitation — rien d'équivalent existant | Non |
| `InterviewEvaluation` | Distinct de `Evaluation` (satisfaction post-Mission, confirmé sans rapport par l'audit) | Non — vérifié explicitement non confondu |
| `CandidateFinalDecision` | Distinct de `deciderSolution`/`SolutionOption(DECISION)` (porte sur une Solution, pas un candidat Talent individuel) | Non, domaines distincts confirmés |
| `InterviewReminder` | `AttentionType` n'a aucune valeur interview — gap confirmé | Non |
| `CalendarSyncRecord` | Aucun équivalent nulle part dans le dépôt | Non |

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED — aucun des 7 objets n'est un
doublon confirmé.** Chaque responsabilité a été croisée contre l'objet
existant le plus proche et vérifiée distincte.

## 18. Future Compatibility

Chaîne vérifiée compatible sans dépendance prématurée : `RoleProfile →
ClientNeed → DemandeTalent → ShortlistEntree → CandidateSelection →
Interview → InterviewEvaluation → Comparison → CandidateFinalDecision →
[futur] Proposal → Mission → MissionAssignment → Outcome → FinancialResult`.
Aucun objet de ce lot ne référence `Proposal` par anticipation (confirmé :
`CandidateFinalDecision` ne contient aucun champ préparant une structure de
Proposal). `Learning`/`Decision Context` : points de raccordement
documentés comme hypothèses futures uniquement, aucune dépendance de code
introduite — confirmé correct, rien à modifier.

**DÉCISION ATLAS DÉFINITIVE** : **APPROVED sans modification.**

## 19. Blockers

**Aucun blocker bloquant l'ensemble du document.** Deux points nécessitaient
un arbitrage et ont été tranchés ici plutôt que laissés ouverts (conformément
à l'exigence de ne jamais inventer silencieusement, mais aussi de ne pas
laisser une ambiguïté non résolue quand une décision raisonnée est possible) :
- Rôle "intervieweur technique" → résolu en sous-attribut de `CLIENT`/
  `ADMIN_RECRUTEUR` (§7), pas une 5ᵉ valeur d'enum.
- Autorité de la Final Decision → résolu en faveur du CLIENT exclusif (§13),
  modification actée.

Aucun des deux ne nécessite un arbitrage humain supplémentaire au-delà de ce
qui est tranché dans ce document.

## 20. Final Architecture Decision

Le Design Contract est **VALIDATED**, avec une modification substantielle
(§13, autorité de la Final Decision) et deux clarifications ajoutées (§7,
rôle intervieweur technique et critère exact de `CONFIRME`). Les 7 objets
proposés sont confirmés non-redondants. Aucune contradiction avec
l'architecture ATLAS existante n'a été trouvée après re-vérification
systématique des faits sous-jacents.

## 21. Conditions for Future Implementation Contract

Non négociables, à inclure explicitement dans le futur Implementation
Contract :

1. Filtrage `ShortlistEntree` au niveau requête Prisma uniquement (§5),
   jamais en post-filtrage applicatif.
2. Test de non-fuite `REJETEE`/`SUGGEREE` obligatoire avant merge (§5).
3. `score`/`confiance`/`motifs` jamais sérialisés dans une route Client (§5).
4. `CandidateFinalDecision` exclusivement Client, Admin en saisie-pour-
   compte uniquement avec `communiqueParClientHorsSysteme` obligatoire,
   jamais une décision Admin autonome (§13).
5. `InterviewParticipant.role` reste à 4 valeurs
   (`CANDIDAT|CLIENT|ADMIN_RECRUTEUR|INTERVIEWEUR_INTERNE` — renommage de
   `INTERVIEWEUR_TECHNIQUE` en `INTERVIEWEUR_INTERNE` recommandé pour éviter
   toute confusion future avec le sous-attribut `fonctionDeclaree` côté
   Client), jamais une 5ᵉ valeur ajoutée sans nouvelle preuve d'usage (§7).
6. `Interview.statut: CONFIRME` exige `statutInvitation: ACCEPTEE` sur
   **tous** les participants `CANDIDAT`/organisateur, jamais une majorité
   (§7).
7. `InterviewEvaluation` visible uniquement par son auteur + ADMIN par
   défaut ; visibilité Client élargie seulement si ce Client était lui-même
   participant à cet `Interview` précis (§11).
8. Aucune des 7 autres recommandations APPROVED sans modification du Design
   Contract ne doit être réouverte sans nouvelle preuve — elles sont
   verrouillées par ce document.

---

## CANDIDATE DECISION + INTERVIEW — CTO VALIDATION

```
HEAD initial:            265f0a8be2a6d162fbaa911293ccad3691f3a58e
HEAD final:              265f0a8be2a6d162fbaa911293ccad3691f3a58e

Design Contract:         VALIDATED

7 decisions:              6 APPROVED, 1 MODIFIED (Final Decision authority, §13)

Security:                 OK
Confidentiality:          OK
Calendar:                 OK
Email:                    OK
Interview:                OK
Final Decision:           OK (sous réserve de la modification §13, intégrée ci-dessus)

Implementation readiness: READY FOR IMPLEMENTATION CONTRACT
                           (conditions non négociables listées en §21)

Commit: NONE
Push:   NONE
```

Après ce document : STOP. Aucun Implementation Contract créé. Aucun code
écrit.
