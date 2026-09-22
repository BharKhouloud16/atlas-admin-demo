import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { emailClientSchema } from "@/lib/validation";
import { journaliser } from "@/lib/audit";

// Réservé à l'Admin (voir /admin/clients) — le middleware protège déjà
// /api/clients, mais on revérifie le rôle ici (defense in depth, comme pour
// les autres routes Admin).
//
// FIX B17 (08/09/2026) — GET prend désormais `req: NextRequest` pour
// pouvoir journaliser l'IP sur un refus RBAC. Le contrôle de rôle ci-dessous
// existait déjà avant B17 (voir commentaire ci-dessus) ; seule la
// journalisation est nouvelle — voir middleware.ts (FIX B17) : ce contrôle
// était jusqu'ici inatteignable pour CLIENT et INGENIEUR, bloqués en amont
// par le middleware avant même d'atteindre ce code, donc jamais journalisé.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/clients",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Client",
      detail: "Tentative d'accès à la liste des clients par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/clients",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Client",
      detail: "Tentative de création de client par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();

  if (!body.nom) {
    return NextResponse.json({ error: "Le nom du client est requis" }, { status: 400 });
  }

  // PHASE 14C — Core Client & Talent Onboarding (22/09/2026). Jusqu'ici
  // cette route créait uniquement la fiche Client (entreprise), sans jamais
  // créer le compte de connexion associé (User) — le seul chemin qui en
  // créait un était l'inscription publique (/api/auth/signup), qui crée
  // TOUJOURS sa propre nouvelle fiche Client, jamais rattachée à celles
  // créées ici : un Client créé par l'Admin ne pouvait donc jamais se
  // connecter. Un email fourni à la création déclenche maintenant aussi la
  // création du compte CLIENT associé (Client.compte, voir schema.prisma) —
  // sans email, le comportement reste exactement celui d'avant (fiche
  // Client seule, aucun compte).
  let emailNormalise: string | null = null;
  if (body.email) {
    const analyseEmail = emailClientSchema.safeParse(body.email);
    if (!analyseEmail.success) {
      return NextResponse.json({ error: analyseEmail.error.issues[0]?.message ?? "Adresse email invalide." }, { status: 400 });
    }
    emailNormalise = analyseEmail.data;

    const existant = await prisma.user.findUnique({ where: { email: emailNormalise } });
    if (existant) {
      return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 });
    }
  }

  // Mot de passe temporaire à usage unique, jamais choisi par l'Admin — même
  // mécanisme que app/api/dev-seed/route.ts (aléatoire, renvoyé une seule
  // fois dans la réponse). Aucun fournisseur d'email n'étant branché (voir
  // README), c'est l'Admin qui le transmet au Client par un canal existant
  // (téléphone, message direct...) — dette opérationnelle documentée,
  // jamais un nouveau système d'invitation.
  const motDePasseTemporaire = emailNormalise ? crypto.randomBytes(9).toString("base64url") : null;

  const donneesClient = {
    nom: body.nom,
    pays: body.pays ?? null,
    secteur: body.secteur ?? null,
    contactReferent: body.contactReferent ?? null,
    email: emailNormalise,
    telephone: body.telephone ?? null,
    statutPreferere: body.statutPreferere ?? null,
    dateDebutPrevue: body.dateDebutPrevue ? new Date(body.dateDebutPrevue) : null,
    notes: body.notes ?? null,
  };

  let client;
  try {
    if (emailNormalise && motDePasseTemporaire) {
      // $transaction uniquement quand un User est réellement créé en plus du
      // Client (atomicité utile ici) — le premier essai de ce lot enveloppait
      // systématiquement les deux écritures, y compris le cas (très
      // majoritaire dans le reste du code existant) où aucun email n'est
      // fourni : la transaction interactive ajoutait alors une latence
      // mesurable à CHAQUE création de Client, y compris celles utilisées
      // comme simple fixture par d'autres tests de la suite, suffisante pour
      // faire déborder la fenêtre des 30 événements les plus récents lue par
      // tests/api/b17-observabilite-talent.spec.ts (régression détectée et
      // confirmée par contrôle A/B lors de cette phase). Aucun email ->
      // aucune transaction -> comportement de performance strictement
      // identique à avant cette phase.
      client = await prisma.$transaction(async (tx) => {
        const c = await tx.client.create({ data: donneesClient });
        // actif et emailVerifie restent aux valeurs par défaut du schéma
        // (true) : un compte créé directement par l'Admin est déjà vetté,
        // aucune file d'attente de validation ni de vérification d'adresse
        // n'a de sens ici (voir prisma/schema.prisma, commentaire sur
        // emailVerifie — même logique que pour un compte préexistant).
        await tx.user.create({
          data: {
            email: emailNormalise,
            passwordHash: await bcrypt.hash(motDePasseTemporaire, 12),
            role: "CLIENT",
            clientId: c.id,
          },
        });
        return c;
      });
    } else {
      client = await prisma.client.create({ data: donneesClient });
    }
  } catch {
    // Ne jamais renvoyer un message d'erreur Prisma brut au client (même
    // discipline que Phase 14B) — le cas prévisible (email déjà pris) est
    // déjà intercepté ci-dessus ; tout le reste reste une erreur générique.
    return NextResponse.json({ error: "Une erreur est survenue lors de la création du client." }, { status: 500 });
  }

  if (motDePasseTemporaire) {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "client.compte.cree",
      cible: `client:${client.id}`,
      detail: `Compte de connexion créé pour ${emailNormalise}`,
    });
  }

  return NextResponse.json({ ...client, motDePasseTemporaire }, { status: 201 });
}
