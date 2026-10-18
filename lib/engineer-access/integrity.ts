import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Calcule les signaux "Access Integrity" (contrat §9/§10) : des FAITS
// explicables dérivés de données réellement persistées, jamais un score
// opaque (jamais `fraudScore`/`trustScore`/`AIProbability`). Chaque signal
// répond à une question binaire/comptable précise ; le décideur humain
// (ADMIN) reste seul juge de ce qu'il en fait — cette fonction ne décide
// jamais rien, ne bloque jamais rien.
//
// Signaux délibérément ABSENTS de cette liste, faute de mécanisme fiable
// existant dans le repo (jamais fabriqués pour "compléter" la liste du
// mandat, contrat §9 "selon les données réellement disponibles") :
// - téléphone réutilisé : aucun champ téléphone n'est collecté à
//   l'inscription d'un candidat INGENIEUR (seul CLIENT en a un, hors
//   périmètre) ;
// - géolocalisation IP, VPN/proxy/Tor : aucune base GeoIP/réputation
//   réseau n'est intégrée au repo — en ajouter une introduirait une
//   nouvelle dépendance externe non demandée explicitement ;
// - email jetable/disposable : aucune liste de domaines fiable n'existe
//   aujourd'hui — en inventer une serait une heuristique non demandée par
//   le contrat (qui la conditionne explicitement à "si une détection
//   fiable disponible") ;
// - CV "fortement similaire" (comparaison floue) : seule une
//   correspondance EXACTE d'empreinte (cvHash) est implémentée ; aucun
//   mécanisme de similarité floue n'existe dans le repo, jamais inventé
//   ici (contrat §9/§10, "ne crée pas encore un moteur CV/IA complexe").

export type SignalIntegrite = {
  cle: string;
  label: string;
  valeur: string;
};

function normaliser(texte: string): string {
  return texte
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Fenêtre utilisée pour le signal "automatisation" — plusieurs inscriptions
// depuis la même adresse IP en quelques minutes évoque un script plutôt
// qu'un humain, mais reste un simple comptage déterministe, jamais une
// inférence IA (contrat §11 : "ne prétends jamais pouvoir déterminer avec
// certitude").
const FENETRE_AUTOMATISATION_MS = 10 * 60 * 1000; // 10 minutes

export async function calculerSignauxIntegrite(userId: string): Promise<SignalIntegrite[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profil: true },
  });
  if (!user) return [];

  const signaux: SignalIntegrite[] = [];

  if (user.profil) {
    const nomNorm = normaliser(user.profil.nom);
    const prenomNorm = user.profil.prenom ? normaliser(user.profil.prenom) : "";
    const autresProfils = await prisma.profil.findMany({
      where: { id: { not: user.profil.id } },
      select: { id: true, nom: true, prenom: true },
    });
    const correspondancesIdentite = autresProfils.filter(
      (p) => normaliser(p.nom) === nomNorm && (p.prenom ? normaliser(p.prenom) : "") === prenomNorm
    );
    signaux.push({
      cle: "identite_connue",
      label: "Identité déclarée (nom + prénom) déjà connue",
      valeur: correspondancesIdentite.length > 0 ? `Oui (${correspondancesIdentite.length} autre(s) compte(s))` : "Non",
    });

    if (user.profil.cvHash) {
      const memeHash = await prisma.profil.count({
        where: { cvHash: user.profil.cvHash, id: { not: user.profil.id } },
      });
      signaux.push({
        cle: "cv_identique",
        label: "CV identique détecté (empreinte exacte)",
        valeur: memeHash > 0 ? `Oui (${memeHash} autre(s) profil(s))` : "Non",
      });
    } else {
      signaux.push({
        cle: "cv_identique",
        label: "CV identique détecté (empreinte exacte)",
        valeur: "Non applicable (aucun CV importé)",
      });
    }
  }

  if (user.inscriptionIp) {
    const autresMemeIp = await prisma.user.findMany({
      where: { inscriptionIp: user.inscriptionIp, id: { not: user.id } },
      select: { id: true, createdAt: true },
    });
    signaux.push({
      cle: "inscriptions_associees",
      label: "Inscriptions associées (même adresse IP)",
      valeur: String(autresMemeIp.length),
    });

    const rapprochees = autresMemeIp.filter(
      (u) => Math.abs(u.createdAt.getTime() - user.createdAt.getTime()) <= FENETRE_AUTOMATISATION_MS
    );
    signaux.push({
      cle: "automatisation",
      label: "Signal d'automatisation (rythme d'inscription)",
      valeur:
        rapprochees.length >= 1
          ? "Détecté (plusieurs inscriptions rapprochées depuis la même adresse IP)"
          : "Aucun signal détecté",
    });
  } else {
    signaux.push({
      cle: "inscriptions_associees",
      label: "Inscriptions associées (même adresse IP)",
      valeur: "Non disponible (adresse IP non capturée pour ce compte)",
    });
  }

  return signaux;
}
