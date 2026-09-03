import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/lib/calculs";
import { getSession } from "@/lib/auth";

// Modèles disponibles dans /templates — chacun doit contenir des balises
// {nom_client}, {tjm_vente}, {nb_jours}, {profil_nom}, {type_contrat}, etc.
// préparées avec Word (insertion de champs texte entre accolades).
const TEMPLATES: Record<string, string> = {
  contrat_prestation: "templates/Contrat_Prestation_Audit_Securite.docx",
  nda: "templates/Accord_Confidentialite_NDA.docx",
  cdi: "templates/CDI_Ingenieur_Cybersecurite.docx",
  freelance: "templates/Contrat_Prestation_Freelance.docx",
  portage: "templates/Convention_Portage_Salarial.docx",
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé pour ce rôle" }, { status: 403 });
  }

  const { missionId, templateKey } = await req.json();

  if (!missionId || !templateKey || !TEMPLATES[templateKey]) {
    return NextResponse.json(
      { error: "missionId et templateKey (contrat_prestation | nda | cdi | freelance | portage) requis" },
      { status: 400 }
    );
  }

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { client: true, profil: true },
  });
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const hyp = await prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} });
  const tjmCout = calculerTjmCout(mission.profil.type, mission.profil.montantSaisi, hyp);

  const templatePath = path.join(process.cwd(), TEMPLATES[templateKey]);
  if (!fs.existsSync(templatePath)) {
    return NextResponse.json(
      { error: `Modèle introuvable : ${templatePath}. Voir templates/README.md pour préparer les .docx.` },
      { status: 500 }
    );
  }

  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  doc.render({
    nom_client: mission.client.nom,
    secteur_client: mission.client.secteur ?? "",
    contact_client: mission.client.contactReferent ?? "",
    email_client: mission.client.email ?? "",
    profil_nom: mission.profil.nom,
    type_contrat: mission.profil.type,
    nb_jours: mission.nbJours,
    tjm_vente: Math.round(mission.tjmVente).toString(),
    tjm_cout: Math.round(tjmCout ?? 0).toString(),
    montant_profil: Math.round(mission.profil.montantSaisi ?? 0).toString(),
    date_generation: new Date().toLocaleDateString("fr-FR"),
  });

  const buffer = doc.getZip().generate({ type: "nodebuffer" });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${templateKey}_${mission.client.nom.replace(/\s+/g, "_")}.docx"`,
    },
  });
}
