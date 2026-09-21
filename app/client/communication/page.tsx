"use client";

import { useEffect, useRef, useState } from "react";
import { grisTexte, bleu, bordure } from "@/lib/theme";
import { Card, Section, EmptyState, Bouton } from "@/components/client/primitives";
import { CONTENU_MESSAGE_MAX } from "@/lib/client-messages";
import { MIME_AUTORISES, TAILLE_MAX_OCTETS, formaterTailleOctets } from "@/lib/piece-jointe-constants";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
//
// Remplace le "Bientôt disponible" (LOT 1) — audit confirmé : aucun
// mécanisme de messagerie n'existait, seul lib/email.ts (transactionnel, à
// sens unique). Fil de discussion simple, sans threading : le client
// écrit à "l'équipe ATLAS" dans son ensemble (jamais à une personne
// nommée), et voit chaque message reçu ou envoyé dans l'ordre
// chronologique — même route/table que le pendant Admin
// (GET/POST /api/clients/[id]/messages), jamais une seconde source de
// vérité.
//
// V2.4 — Pièces jointes sécurisées (Lot 5, 21/09/2026) : un fichier
// optionnel peut être joint à un message. Flux en 2 appels réseau pour 1
// seule action utilisateur ("Envoyer") : le message texte est créé
// d'abord (POST /api/client/messages, inchangé), puis la pièce jointe est
// uploadée sur ce message (POST .../pieces-jointes, Lot 1) — jamais
// l'inverse, une pièce jointe n'existe jamais sans Message parent (voir
// prisma/schema.prisma, messageId non nul). Un échec d'upload n'efface
// jamais le message déjà envoyé (best-effort, même discipline que le
// reste de la suite) : seule une erreur claire est affichée. Validation
// client complémentaire (MIME + taille) avant tout envoi réseau — jamais
// en remplacement de la validation serveur (lib/piece-jointe.ts), qui
// reste la seule source de vérité (elle revérifie aussi les premiers
// octets du fichier, ce qu'un contrôle côté navigateur ne peut jamais
// garantir).

type PieceJointe = { id: string; nomFichier: string; mimeType: string; tailleOctets: number; createdAt: string };
type Message = { id: string; auteurRole: "CLIENT" | "ADMIN"; contenu: string; createdAt: string; pieceJointes: PieceJointe[] };

export default function CommunicationClientPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [brouillon, setBrouillon] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [fichierSelectionne, setFichierSelectionne] = useState<File | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const finDeListe = useRef<HTMLDivElement>(null);
  const entreeFichier = useRef<HTMLInputElement>(null);

  function charger() {
    setErreurChargement(false);
    fetch("/api/client/messages")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        setMessages(d.messages ?? []);
        setChargement(false);
      })
      .catch(() => {
        setErreurChargement(true);
        setChargement(false);
      });
  }

  useEffect(() => {
    charger();
  }, []);

  useEffect(() => {
    finDeListe.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  function selectionnerFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0] ?? null;
    e.target.value = ""; // permet de resélectionner le même fichier après une erreur
    setErreurFichier(null);
    if (!fichier) return;
    if (!(MIME_AUTORISES as readonly string[]).includes(fichier.type)) {
      setErreurFichier("Type de fichier non autorisé.");
      return;
    }
    if (fichier.size > TAILLE_MAX_OCTETS) {
      setErreurFichier(`Fichier trop volumineux (${formaterTailleOctets(TAILLE_MAX_OCTETS)} maximum).`);
      return;
    }
    setFichierSelectionne(fichier);
  }

  async function envoyer() {
    const contenu = brouillon.trim();
    if (contenu.length === 0 || contenu.length > CONTENU_MESSAGE_MAX) return;

    setErreurEnvoi(null);
    setEnvoi(true);
    const reponse = await fetch("/api/client/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenu }),
    });
    if (!reponse.ok) {
      setEnvoi(false);
      const d = await reponse.json().catch(() => ({}));
      setErreurEnvoi(d.error ?? "Une erreur est survenue, réessayez.");
      return;
    }
    const { message } = await reponse.json();

    if (fichierSelectionne) {
      const formulaire = new FormData();
      formulaire.append("fichier", fichierSelectionne);
      const reponsePiece = await fetch(`/api/client/messages/${message.id}/pieces-jointes`, { method: "POST", body: formulaire });
      if (!reponsePiece.ok) {
        const d = await reponsePiece.json().catch(() => ({}));
        setErreurEnvoi(`Message envoyé, mais la pièce jointe n'a pas pu être ajoutée : ${d.error ?? "erreur inconnue"}.`);
      }
      setFichierSelectionne(null);
    }

    setEnvoi(false);
    setBrouillon("");
    charger();
  }

  return (
    <Section title="Communication">
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ maxHeight: 480, overflowY: "auto", padding: 16 }}>
          {chargement && <EmptyState message="Chargement…" />}
          {!chargement && erreurChargement && <EmptyState message="Impossible de charger la conversation pour l'instant." />}
          {!chargement && !erreurChargement && messages.length === 0 && (
            <EmptyState message="Aucun message pour l'instant — écrivez à l'équipe ATLAS ci-dessous." />
          )}
          {!chargement && !erreurChargement && messages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((m) => (
                <div key={m.id} style={{ alignSelf: m.auteurRole === "CLIENT" ? "flex-end" : "flex-start", maxWidth: "75%" }}>
                  <div
                    style={{
                      background: m.auteurRole === "CLIENT" ? bleu : "#f1f3f8",
                      color: m.auteurRole === "CLIENT" ? "#fff" : "#111",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 13,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.contenu}
                  </div>
                  {m.pieceJointes.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                      {m.pieceJointes.map((p) => (
                        <a
                          key={p.id}
                          href={`/api/client/messages/pieces-jointes/${p.id}/fichier`}
                          aria-label={`Télécharger la pièce jointe ${p.nomFichier}, ${formaterTailleOctets(p.tailleOctets)}`}
                          style={{ fontSize: 12, color: m.auteurRole === "CLIENT" ? bleu : "#333", textDecoration: "underline", alignSelf: m.auteurRole === "CLIENT" ? "flex-end" : "flex-start" }}
                        >
                          📎 {p.nomFichier} ({formaterTailleOctets(p.tailleOctets)})
                        </a>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: "3px 4px 0", fontSize: 11, color: grisTexte }}>
                    {m.auteurRole === "CLIENT" ? "Vous" : "Équipe ATLAS"} · {new Date(m.createdAt).toLocaleString("fr-FR")}
                  </p>
                </div>
              ))}
              <div ref={finDeListe} />
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${bordure}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={brouillon}
            onChange={(e) => setBrouillon(e.target.value)}
            placeholder="Écrire à l'équipe ATLAS…"
            maxLength={CONTENU_MESSAGE_MAX}
            rows={3}
            aria-label="Votre message"
            style={{ width: "100%", padding: 8, borderRadius: 6, border: `1px solid ${bordure}`, fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
          />

          <input
            ref={entreeFichier}
            type="file"
            onChange={selectionnerFichier}
            accept={(MIME_AUTORISES as readonly string[]).join(",")}
            style={{ display: "none" }}
            aria-label="Choisir un fichier à joindre"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => entreeFichier.current?.click()}
              aria-label="Joindre un fichier"
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 6,
                border: `1px solid ${bordure}`,
                background: "#fff",
                cursor: "pointer",
                color: grisTexte,
              }}
            >
              📎 Joindre un fichier
            </button>
            {fichierSelectionne && (
              <span style={{ fontSize: 12, color: grisTexte, display: "flex", alignItems: "center", gap: 6 }}>
                {fichierSelectionne.name} ({formaterTailleOctets(fichierSelectionne.size)})
                <button
                  type="button"
                  onClick={() => setFichierSelectionne(null)}
                  aria-label={`Retirer la pièce jointe ${fichierSelectionne.name}`}
                  style={{ border: "none", background: "none", color: "#c0392b", cursor: "pointer", fontSize: 12, padding: 0 }}
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          {erreurFichier && (
            <p role="alert" style={{ color: "#c0392b", fontSize: 12, margin: 0 }}>
              {erreurFichier}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: grisTexte }}>
              {brouillon.length} / {CONTENU_MESSAGE_MAX}
            </span>
            <Bouton onClick={envoyer} disabled={envoi || brouillon.trim().length === 0}>
              {envoi ? "Envoi…" : "Envoyer"}
            </Bouton>
          </div>
          {erreurEnvoi && (
            <p role="alert" style={{ color: "#c0392b", fontSize: 12, margin: 0 }}>
              {erreurEnvoi}
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}
