import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/lib/calculs";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { estTemplateInterneIngenieur } from "@/lib/security/contrats";

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

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16,
// 08/09/2026) — CORRECTIF trouvé pendant l'audit "sensitive-data
// protection / trust boundaries" (directive B16, section 2) : cdi/freelance/
// portage sont des contrats AVEC l'ingénieur (montant_profil = sa
// rémunération, une donnée qui LUI est destinée, légitime) ; contrat_prestation
// et nda sont des documents destinés au CLIENT. templates/README.md
// documentait déjà, en commentaire humain, que {tjm_cout} (coût interne
// Atlas) ne doit "jamais" être inséré dans un contrat client — mais rien
// dans le code ne l'empêchait réellement : doc.render() ne substitue que
// les balises présentes dans le .docx, donc tant qu'aucun contrat client
// ne contient {tjm_cout}/{montant_profil} le risque restait théorique,
// mais RIEN ne l'empêchait si un futur modèle client ajoutait cette
// balise (aucune revue de code ne porte sur l'édition d'un .docx). Cette
// liste ferme cette faille structurellement, côté code, indépendamment de
// ce que contient chaque modèle .docx aujourd'hui.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const correlationId = nouveauCorrelationId();
  const contexteRoute = "/api/generate-contract";
  const contexteIp = adresseIp(req);

  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId,
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp,
      contexteRoute,
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Contrat",
      detail: "Tentative de génération de contrat par un rôle non-Admin.",
    });
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

  // tjm_cout et montant_profil (coût/rémunération interne) ne sont fournis
  // au rendu QUE pour les modèles internes (contrat avec l'ingénieur lui-même)
  // — voir commentaire ci-dessus. Pour contrat_prestation/nda (client), ces
  // clés sont simplement absentes de l'objet : si le .docx contenait malgré
  // tout la balise, docxtemplater la laisserait vide plutôt que de fuiter
  // une donnée interne.
  const estTemplateInterne = estTemplateInterneIngenieur(templateKey);
  doc.render({
    nom_client: mission.client.nom,
    secteur_client: mission.client.secteur ?? "",
    contact_client: mission.client.contactReferent ?? "",
    email_client: mission.client.email ?? "",
    profil_nom: mission.profil.nom,
    type_contrat: mission.profil.type,
    nb_jours: mission.nbJours,
    tjm_vente: Math.round(mission.tjmVente).toString(),
    date_generation: new Date().toLocaleDateString("fr-FR"),
    ...(estTemplateInterne
      ? {
          tjm_cout: Math.round(tjmCout ?? 0).toString(),
          montant_profil: Math.round(mission.profil.montantSaisi ?? 0).toString(),
        }
      : {}),
  });

  const buffer = doc.getZip().generate({ type: "nodebuffer" });

  await enregistrerEvenementSecurite({
    correlationId,
    action: "contrat.generation",
    resultat: "SUCCES",
    severite: "INFO",
    contexteIp,
    contexteRoute,
    acteurEmail: session.email,
    acteurRole: session.role,
    ressourceType: "Mission",
    ressourceId: mission.id,
    detail: `Modèle ${templateKey} généré pour la mission ${mission.id} (client ${mission.clientId}).`,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${templateKey}_${mission.client.nom.replace(/\s+/g, "_")}.docx"`,
    },
  });
}
