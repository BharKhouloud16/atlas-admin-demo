import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { requirementStructureSchema, criteresGuidesSchema, premierMessageZod } from "@/lib/validation";
import { construireRequirementDepuisCriteresGuides } from "@/lib/talent/requirement-analyzer";

// ATLAS LOT 15.5 — Client Requirement Builder : confirmation du besoin
// structuré (Partie E — "l'IA propose, le Client décide") ou construction
// directe en mode Critères guidés (Partie B, Mode 2). Les deux chemins
// convergent vers exactement la même forme, RequirementStructure, persistée
// dans DemandeTalent.criteresStructures — jamais les champs
// competencesExtraites/etc. existants (source de vérité du Matching Engine
// Admin, jamais modifiés par ce lot).
//
// Réservé au Client propriétaire (même principe d'isolation que
// .../besoin/analyser).
const corpsSchema = z.union([
  z.object({ requirement: requirementStructureSchema }),
  z.object({ criteresGuides: criteresGuidesSchema }),
]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès réservé aux clients" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({
    where: { id: params.id, clientId: session.clientId },
    select: { id: true },
  });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  const corps = await req.json().catch(() => ({}));
  const analyse = corpsSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const requirement =
    "requirement" in analyse.data ? analyse.data.requirement : construireRequirementDepuisCriteresGuides(analyse.data.criteresGuides);

  const apres = await prisma.demandeTalent.update({
    where: { id: params.id },
    data: { criteresStructures: requirement },
    select: { id: true, criteresStructures: true },
  });

  return NextResponse.json(apres);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès réservé aux clients" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({
    where: { id: params.id, clientId: session.clientId },
    select: { id: true, criteresStructures: true },
  });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  return NextResponse.json(demande);
}
