// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Dérivation de SIGNAUX explicables à partir des FAITS bruts (des
// EvenementSecurite, voir lib/security/events.ts) — jamais l'inverse
// (même discipline que deriverSignaux, lib/quality/domain.ts et
// lib/security/signals.ts, B12/B13 : FACT -> SIGNAL, pas de raccourci).
//
// Fonctions PURES, sans accès base de données (le fetch des événements
// reste dans la route API, voir app/api/security/runtime/route.ts) — même
// principe que lib/security/*.ts (B13) : testable unitairement sans DB.
//
// RÈGLES (directive B16, sections 4 et 11 "UNKNOWN ≠ FAIL, n'invente
// jamais d'anomalie") : chaque catégorie de signal demandée par la
// directive est représentée, mais UNIQUEMENT celles pour lesquelles ce lot
// dispose réellement d'une source de donnée (EvenementSecurite) produisent
// un vrai calcul.
//
// MISE À JOUR B17 (08/09/2026) — "accès anormal à des objets" est passé de
// UNKNOWN à un signal calculé : app/api/missions/[id]/marge-intelligence
// journalise désormais un événement SUCCÈS (action "objet.consultation")
// à chaque lecture, avec ressourceType/ressourceId. La source de donnée
// existe donc réellement (directive B17, section 3 : "étendre les signaux
// uniquement lorsque les données nécessaires existent réellement"). La
// règle reste un simple seuil explicite sur un comptage brut — même
// discipline que les signaux 1 à 4, aucune inférence, aucun apprentissage.
// "changement inhabituel de permissions" reste UNKNOWN : aucun événement
// de modification de permission/rôle n'est journalisé dans ce lot non plus
// (RBAC toujours géré par User.role + middleware.ts, jamais modifié en
// base via une action journalisable) — resterait simulé si calculé ici.

export type EvenementSecuriteAllege = {
  action: string;
  resultat: "SUCCES" | "REFUSE" | "ERREUR";
  acteurEmail: string | null;
  contexteIp: string | null;
  ressourceType: string | null;
  ressourceId: string | null;
  createdAt: Date;
};

export type SignalRuntime = {
  regle: string;
  titre: string;
  statut: "SIGNAL_DETECTE" | "AUCUN_SIGNAL" | "UNKNOWN";
  fait: string; // description factuelle courte de ce qui a été compté — jamais un jugement
  explication: string;
};

const FENETRE_MS = 15 * 60 * 1000; // 15 minutes, même fenêtre que lib/rate-limit.ts pour rester cohérent

function dansLaFenetre(evenements: EvenementSecuriteAllege[], maintenant: Date): EvenementSecuriteAllege[] {
  return evenements.filter((e) => maintenant.getTime() - e.createdAt.getTime() <= FENETRE_MS);
}

function grouperPar<T>(items: T[], cle: (item: T) => string | null): Map<string, T[]> {
  const carte = new Map<string, T[]>();
  for (const item of items) {
    const k = cle(item);
    if (!k) continue;
    const liste = carte.get(k) ?? [];
    liste.push(item);
    carte.set(k, liste);
  }
  return carte;
}

// SIGNAL 1 — accès refusés répétés (le même acteur, ou à défaut la même
// IP si l'acteur n'est pas authentifié, cumule plusieurs refus RBAC sur la
// fenêtre courante).
const SEUIL_REFUS_REPETES = 5;
export function signalAccesRefusesRepetes(evenements: EvenementSecuriteAllege[], maintenant: Date): SignalRuntime {
  const fenetre = dansLaFenetre(evenements, maintenant).filter(
    (e) => e.resultat === "REFUSE" && e.action === "rbac.acces_refuse"
  );
  if (fenetre.length === 0) {
    return {
      regle: "acces_refuses_repetes",
      titre: "Accès refusés répétés",
      statut: "AUCUN_SIGNAL",
      fait: "0 refus RBAC sur les 15 dernières minutes.",
      explication: "Aucun refus d'accès observé sur la fenêtre courante.",
    };
  }
  const parActeur = grouperPar(fenetre, (e) => e.acteurEmail ?? e.contexteIp ?? null);
  let pire: { cle: string; count: number } | null = null;
  for (const [cle, liste] of parActeur) {
    if (!pire || liste.length > pire.count) pire = { cle, count: liste.length };
  }
  if (pire && pire.count >= SEUIL_REFUS_REPETES) {
    return {
      regle: "acces_refuses_repetes",
      titre: "Accès refusés répétés",
      statut: "SIGNAL_DETECTE",
      fait: `${pire.cle} : ${pire.count} refus RBAC en 15 minutes (seuil ${SEUIL_REFUS_REPETES}).`,
      explication: "Un même acteur (ou IP) a dépassé le seuil de refus d'accès consécutifs sur la fenêtre courante — signal explicable par comptage, aucune inférence.",
    };
  }
  return {
    regle: "acces_refuses_repetes",
    titre: "Accès refusés répétés",
    statut: "AUCUN_SIGNAL",
    fait: `${fenetre.length} refus RBAC en 15 minutes, aucun acteur/IP au-dessus du seuil (${SEUIL_REFUS_REPETES}).`,
    explication: "Refus observés mais sous le seuil de répétition.",
  };
}

// SIGNAL 2 — volume anormal (nombre total d'événements sur la fenêtre,
// tous types confondus, au-delà d'un seuil statique documenté — pas de
// modèle statistique, pas de "normal" appris : un seuil fixe et explicite).
const SEUIL_VOLUME = 200;
export function signalVolumeAnormal(evenements: EvenementSecuriteAllege[], maintenant: Date): SignalRuntime {
  const fenetre = dansLaFenetre(evenements, maintenant);
  if (fenetre.length >= SEUIL_VOLUME) {
    return {
      regle: "volume_anormal",
      titre: "Volume d'événements anormal",
      statut: "SIGNAL_DETECTE",
      fait: `${fenetre.length} événements de sécurité en 15 minutes (seuil ${SEUIL_VOLUME}).`,
      explication: "Volume total au-dessus du seuil fixe documenté — pas d'inférence, uniquement un comptage.",
    };
  }
  return {
    regle: "volume_anormal",
    titre: "Volume d'événements anormal",
    statut: "AUCUN_SIGNAL",
    fait: `${fenetre.length} événements en 15 minutes (seuil ${SEUIL_VOLUME}).`,
    explication: "Volume sous le seuil.",
  };
}

// SIGNAL 3 — erreurs répétées (même action en résultat ERREUR, plusieurs
// fois sur la fenêtre) : symptôme possible d'un bug exploité ou d'un
// dysfonctionnement, jamais qualifié plus précisément ici (UNKNOWN reste
// permis en aval, voir lib/security/runtime-risk.ts).
const SEUIL_ERREURS_REPETEES = 5;
export function signalErreursRepetees(evenements: EvenementSecuriteAllege[], maintenant: Date): SignalRuntime {
  const fenetre = dansLaFenetre(evenements, maintenant).filter((e) => e.resultat === "ERREUR");
  const parAction = grouperPar(fenetre, (e) => e.action);
  let pire: { action: string; count: number } | null = null;
  for (const [action, liste] of parAction) {
    if (!pire || liste.length > pire.count) pire = { action, count: liste.length };
  }
  if (pire && pire.count >= SEUIL_ERREURS_REPETEES) {
    return {
      regle: "erreurs_repetees",
      titre: "Erreurs répétées",
      statut: "SIGNAL_DETECTE",
      fait: `${pire.action} : ${pire.count} erreurs en 15 minutes (seuil ${SEUIL_ERREURS_REPETEES}).`,
      explication: "Une même action a échoué en erreur plusieurs fois sur la fenêtre — comptage brut, cause non déterminée.",
    };
  }
  return {
    regle: "erreurs_repetees",
    titre: "Erreurs répétées",
    statut: "AUCUN_SIGNAL",
    fait: `${fenetre.length} erreurs en 15 minutes, aucune action au-dessus du seuil (${SEUIL_ERREURS_REPETEES}).`,
    explication: "Pas de série d'erreurs répétées détectée.",
  };
}

// SIGNAL 4 — séquence suspecte (plusieurs échecs de connexion suivis d'un
// succès, pour le même acteur, sur la fenêtre courante — schéma classique
// de credential stuffing/bruteforce réussi). Règle nommée et explicite,
// pas un modèle de détection générique.
const SEUIL_ECHECS_AVANT_SUCCES = 3;
export function signalSequenceSuspecteConnexion(evenements: EvenementSecuriteAllege[], maintenant: Date): SignalRuntime {
  const fenetre = dansLaFenetre(evenements, maintenant).filter((e) => e.action.startsWith("auth.login."));
  const parActeur = grouperPar(fenetre, (e) => e.acteurEmail);
  for (const [acteur, liste] of parActeur) {
    const tries = [...liste].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const echecsAvantSucces = tries.filter((e) => e.action === "auth.login.echec").length;
    const aReussi = tries.some((e) => e.resultat === "SUCCES");
    if (aReussi && echecsAvantSucces >= SEUIL_ECHECS_AVANT_SUCCES) {
      return {
        regle: "sequence_suspecte_connexion",
        titre: "Séquence de connexion suspecte",
        statut: "SIGNAL_DETECTE",
        fait: `${acteur} : ${echecsAvantSucces} échecs de connexion suivis d'un succès en 15 minutes (seuil ${SEUIL_ECHECS_AVANT_SUCCES}).`,
        explication: "Plusieurs échecs suivis d'une réussite pour le même compte — schéma explicable (tentative répétée puis succès), ne préjuge pas de l'intention.",
      };
    }
  }
  return {
    regle: "sequence_suspecte_connexion",
    titre: "Séquence de connexion suspecte",
    statut: "AUCUN_SIGNAL",
    fait: `${fenetre.length} événements de connexion en 15 minutes, aucune séquence échec(s)->succès au-dessus du seuil (${SEUIL_ECHECS_AVANT_SUCCES}).`,
    explication: "Aucune séquence suspecte détectée sur la fenêtre.",
  };
}

// SIGNAL 5 — accès anormal à des objets (B17) : un même acteur consulte un
// nombre inhabituellement élevé d'objets distincts (mission, client...) sur
// la fenêtre courante. Repose sur les événements "objet.consultation"
// (SUCCÈS) journalisés depuis B17 pour les lectures sensibles (voir
// app/api/missions/[id]/marge-intelligence/route.ts) — un objet consulté
// une seule fois ne compte qu'une fois (distinct par ressourceId), pour ne
// pas confondre "beaucoup de clics" avec "beaucoup d'objets différents
// consultés". Seuil fixe et documenté, même discipline que les signaux 1 à
// 4 — aucun apprentissage, aucun profil de comportement "normal" construit.
const SEUIL_OBJETS_DISTINCTS_CONSULTES = 20;
export function signalAccesAnormalObjets(evenements: EvenementSecuriteAllege[], maintenant: Date): SignalRuntime {
  const fenetre = dansLaFenetre(evenements, maintenant).filter(
    (e) => e.action === "objet.consultation" && e.resultat === "SUCCES" && e.ressourceId
  );
  if (fenetre.length === 0) {
    return {
      regle: "acces_anormal_objets",
      titre: "Accès anormal à des objets",
      statut: "AUCUN_SIGNAL",
      fait: "0 lecture d'objet sensible journalisée sur les 15 dernières minutes.",
      explication: "Aucune lecture d'objet sensible observée sur la fenêtre courante.",
    };
  }
  const parActeur = grouperPar(fenetre, (e) => e.acteurEmail ?? e.contexteIp ?? null);
  let pire: { cle: string; count: number } | null = null;
  for (const [cle, liste] of parActeur) {
    const distincts = new Set(liste.map((e) => e.ressourceId));
    if (!pire || distincts.size > pire.count) pire = { cle, count: distincts.size };
  }
  if (pire && pire.count >= SEUIL_OBJETS_DISTINCTS_CONSULTES) {
    return {
      regle: "acces_anormal_objets",
      titre: "Accès anormal à des objets",
      statut: "SIGNAL_DETECTE",
      fait: `${pire.cle} : ${pire.count} objets distincts consultés en 15 minutes (seuil ${SEUIL_OBJETS_DISTINCTS_CONSULTES}).`,
      explication: "Un même acteur a consulté un nombre d'objets distincts au-dessus du seuil fixe sur la fenêtre courante — comptage brut, aucune inférence sur l'intention.",
    };
  }
  return {
    regle: "acces_anormal_objets",
    titre: "Accès anormal à des objets",
    statut: "AUCUN_SIGNAL",
    fait: `${fenetre.length} lectures d'objets sensibles en 15 minutes, aucun acteur au-dessus du seuil (${SEUIL_OBJETS_DISTINCTS_CONSULTES} objets distincts).`,
    explication: "Volume de lecture d'objets sous le seuil.",
  };
}

// Catégorie demandée par la directive B16 (section 4) pour laquelle ce lot
// NE DISPOSE PAS d'une source de donnée observable — voir en-tête de
// fichier. Retournée explicitement en UNKNOWN plutôt que simulée ou omise
// silencieusement (directive B16 : "UNKNOWN ≠ FAIL").
export function signauxSansSourceDeDonnee(): SignalRuntime[] {
  return [
    {
      regle: "changement_inhabituel_permissions",
      titre: "Changement inhabituel de permissions",
      statut: "UNKNOWN",
      fait: "Aucun événement de modification de permission/rôle n'est journalisé dans ce lot.",
      explication: "Pas de source de donnée observable — ce lot ne modifie pas les mécanismes d'attribution de rôle (RBAC déjà géré par User.role + middleware.ts). Signal non calculable, volontairement non simulé.",
    },
  ];
}

export function calculerSignauxRuntime(evenements: EvenementSecuriteAllege[], maintenant: Date = new Date()): SignalRuntime[] {
  return [
    signalAccesRefusesRepetes(evenements, maintenant),
    signalVolumeAnormal(evenements, maintenant),
    signalErreursRepetees(evenements, maintenant),
    signalSequenceSuspecteConnexion(evenements, maintenant),
    signalAccesAnormalObjets(evenements, maintenant),
    ...signauxSansSourceDeDonnee(),
  ];
}
