import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// POST est volontairement PUBLIC (aucune session requise) : un prospect ne
// doit pas creer de compte pour reserver un appel de 30 minutes ou envoyer
// un message via le formulaire de contact du site (voir
                                                    // app/reserver-appel/page.tsx). GET/PATCH sont reserves a l'Admin, qui
// traite les demandes depuis app/admin/demandes/page.tsx.

function emailValide(email: string) {
return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
const body = await req.json().catch(() => null);
if (!body) {
return NextResponse.json({ error: "Requete invalide." }, { status: 400 });
}

const { nom, email, entreprise, telephone, message, creneauSouhaite } = body;

if (typeof nom !== "string" || !nom.trim()) {
return NextResponse.json({ error: "Merci d'indiquer votre nom." }, { status: 400 });
}
if (typeof email !== "string" || !emailValide(email.trim())) {
return NextResponse.json({ error: "Merci d'indiquer une adresse email valide." }, { status: 400 });
}

const demande = await prisma.demandeContact.create({
data: {
nom: nom.trim(),
email: email.trim(),
entreprise: typeof entreprise === "string" && entreprise.trim() ? entreprise.trim() : null,
telephone: typeof telephone === "string" && telephone.trim() ? telephone.trim() : null,
message: typeof message === "string" && message.trim() ? message.trim() : null,
creneauSouhaite:
typeof creneauSouhaite === "string" && creneauSouhaite.trim() ? creneauSouhaite.trim() : null,
},
});

// Notification a l'equipe Atlas : lib/email.ts n'a pas encore de vrai
// fournisseur branche (log Vercel uniquement pour l'instant) -- la demande
// reste de toute facon consultable immediatement dans /admin/demandes, et
// un echec de notification ne doit jamais bloquer l'enregistrement.
try {
const { envoyerEmailNouvelleDemandeContact } = await import("@/lib/email");
await envoyerEmailNouvelleDemandeContact({
to: "contact@atlas-qa.com",
nom: demande.nom,
email: demande.email,
entreprise: demande.entreprise,
telephone: demande.telephone,
message: demande.message,
creneauSouhaite: demande.creneauSouhaite,
});
} catch {
// ne jamais bloquer l'enregistrement de la demande sur un echec de notif.
}

return NextResponse.json({ ok: true }, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acces reserve a l'administrateur" }, { status: 403 });
    }

  const demandes = await prisma.demandeContact.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(demandes);
  }

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acces reserve a l'administrateur" }, { status: 403 });
    }

  const body = await req.json();
  if (!body?.id || typeof body.traite !== "boolean") {
    return NextResponse.json({ error: "id et traite requis" }, { status: 400 });
    }

  const demande = await prisma.demandeContact.update({
    where: { id: body.id },
    data: { traite: body.traite },
    });

  return NextResponse.json(demande);
  }
