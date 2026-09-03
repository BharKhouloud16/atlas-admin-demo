import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Inscription publique — jamais pour le rôle ADMIN (créé uniquement en base
// par un administrateur existant, voir prisma/create-admin.ts).
// Le compte créé démarre avec actif=false : il ne peut pas se connecter tant
// qu'un ADMIN ne l'a pas validé depuis /admin/comptes-en-attente.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, role, nom } = body;

  if (!email || !password || !role || !nom) {
    return NextResponse.json({ error: "Email, mot de passe, rôle et nom sont requis" }, { status: 400 });
  }
  if (role !== "INGENIEUR" && role !== "CLIENT") {
    return NextResponse.json({ error: "Inscription possible uniquement pour Ingénieur ou Client" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Le mot de passe doit contenir au moins 8 caractères" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (role === "INGENIEUR") {
    // Crée une fiche Profil vide (sans tarif) que l'Admin complètera à la validation
    const profil = await prisma.profil.create({ data: { nom } });
    const user = await prisma.user.create({
      data: { email, passwordHash, role: "INGENIEUR", actif: false, profilId: profil.id },
    });
    return NextResponse.json({ ok: true, message: "Compte créé, en attente de validation par l'administrateur.", id: user.id }, { status: 201 });
  }

  // role === "CLIENT"
  const client = await prisma.client.create({
    data: { nom, email, contactReferent: body.contactReferent ?? null, secteur: body.secteur ?? null },
  });
  const user = await prisma.user.create({
    data: { email, passwordHash, role: "CLIENT", actif: false, clientId: client.id },
  });
  return NextResponse.json({ ok: true, message: "Compte créé, en attente de validation par l'administrateur.", id: user.id }, { status: 201 });
}
