import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const documents = await prisma.document.findMany({
    where: { clientId: session.clientId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(documents);
}
