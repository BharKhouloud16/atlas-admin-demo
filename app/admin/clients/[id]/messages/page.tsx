"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import { MIME_AUTORISES, TAILLE_MAX_OCTETS, formaterTailleOctets } from "@/lib/piece-jointe-constants";
import { PreferenceNotificationPanel } from "@/components/PreferenceNotificationPanel";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
//
// Pendant Admin de /client/communication — même table Message (voir
// GET/POST /api/clients/[id]/messages), même absence de threading. Le nom
// du client est relu depuis GET /api/clients (déjà existant, déjà
// utilisé par app/admin/clients/page.tsx) plutôt que de créer une route
// GET /api/clients/[id] uniquement pour un nom — API minimale.
//
// V2.4 — Pièces jointes sécurisées (Lot 6, 21/09/2026) : même logique que
// le composer Client (Lot 5) — upload en 2 appels réseau pour 1 action
// utilisateur, validation client complémentaire jamais en remplacement de
// la validation serveur — plus la suppression logique, réservée à ce
// pendant Admin par le mandat (DELETE .../pieces-jointes/[pieceId], Lot
// 4) : une pièce supprimée disparaît immédiatement de l'affichage (la
// liste ne renvoie plus les pièces avec supprimeLe non nul, voir
// GET /api/clients/[id]/messages).

type PieceJointe = { id: string; nomFichier: string; mimeType: string; tailleOctets: number; createdAt: string };
type Message = { id: string; auteurRole: "CLIENT" | "ADMIN"; contenu: string; createdAt: string; pieceJointes: PieceJointe[] };
type Client = { id: string; nom: string };

const CONTENU_MESSAGE_MAX = 2000;

export default function MessagesClientAdminPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [client, setClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [brouillon, setBrouillon] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [fichierSelectionne, setFichierSelectionne] = useState<File | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState<string | null>(null);
  const finDeListe = useRef<HTMLDivElement>(null);
  const entreeFichier = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((liste: Client[]) => setClient(liste.find((c) => c.id === id) ?? null));
  }, [id]);

  function charger() {
    setErreurChargement(false);
    fetch(`/api/clients/${id}/messages`)
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
    // V2.5 — Communication Intelligence (Lot 5, 21/09/2026) : ouverture du
    // fil -> marquage lu propre à CET Admin (règle #7, best-effort, jamais
    // bloquant pour l'affichage).
    fetch(`/api/clients/${id}/messages/lu`, { method: "POST" }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    finDeListe.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  function selectionnerFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0] ?? null;
    e.target.value = "";
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
    const reponse = await fetch(`/api/clients/${id}/messages`, {
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
      const reponsePiece = await fetch(`/api/clients/${id}/messages/${message.id}/pieces-jointes`, { method: "POST", body: formulaire });
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

  async function supprimerPiece(pieceId: string) {
    setSuppressionEnCours(pieceId);
    await fetch(`/api/clients/${id}/messages/pieces-jointes/${pieceId}`, { method: "DELETE" });
    setSuppressionEnCours(null);
    charger();
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link href="/admin/clients" style={{ fontSize: 13, color: bleu, textDecoration: "none" }}>
          ← Clients
        </Link>
        <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>
          Messages{client ? ` — ${client.nom}` : ""}
        </h1>
      </div>

      <div style={{ maxWidth: 720 }}>
        <PreferenceNotificationPanel apiUrl="/api/admin/attentions/preferences" />
      </div>

      <div style={{ border: `1px solid ${bordure}`, borderRadius: 10, background: "#fff", maxWidth: 720 }}>
        <div style={{ maxHeight: 480, overflowY: "auto", padding: 16 }}>
          {chargement && <p style={{ fontSize: 13, color: grisTexte }}>Chargement…</p>}
          {!chargement && erreurChargement && (
            <p style={{ fontSize: 13, color: grisTexte }}>Impossible de charger la conversation pour l&apos;instant.</p>
          )}
          {!chargement && !erreurChargement && messages.length === 0 && (
            <p style={{ fontSize: 13, color: grisTexte }}>Aucun message pour l&apos;instant.</p>
          )}
          {!chargement && !erreurChargement && messages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((m) => (
                <div key={m.id} style={{ alignSelf: m.auteurRole === "ADMIN" ? "flex-end" : "flex-start", maxWidth: "75%" }}>
                  <div
                    style={{
                      background: m.auteurRole === "ADMIN" ? bleu : "#f1f3f8",
                      color: m.auteurRole === "ADMIN" ? "#fff" : "#111",
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
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: m.auteurRole === "ADMIN" ? "flex-end" : "flex-start" }}>
                          <a
                            href={`/api/clients/${id}/messages/pieces-jointes/${p.id}/fichier`}
                            aria-label={`Télécharger la pièce jointe ${p.nomFichier}, ${formaterTailleOctets(p.tailleOctets)}`}
                            style={{ fontSize: 12, color: m.auteurRole === "ADMIN" ? bleu : "#333", textDecoration: "underline" }}
                          >
                            📎 {p.nomFichier} ({formaterTailleOctets(p.tailleOctets)})
                          </a>
                          <button
                            type="button"
                            onClick={() => supprimerPiece(p.id)}
                            disabled={suppressionEnCours === p.id}
                            aria-label={`Supprimer la pièce jointe ${p.nomFichier}`}
                            style={{ border: "none", background: "none", color: "#c0392b", cursor: "pointer", fontSize: 11, padding: 0 }}
                          >
                            {suppressionEnCours === p.id ? "…" : "Supprimer"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: "3px 4px 0", fontSize: 11, color: grisTexte }}>
                    {m.auteurRole === "ADMIN" ? "Équipe ATLAS" : client?.nom ?? "Client"} · {new Date(m.createdAt).toLocaleString("fr-FR")}
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
            placeholder="Répondre au client…"
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
              style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer", color: grisTexte }}
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
            <button
              onClick={envoyer}
              disabled={envoi || brouillon.trim().length === 0}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 14px",
                borderRadius: 6,
                border: "none",
                background: bleu,
                color: "#fff",
                cursor: envoi || brouillon.trim().length === 0 ? "default" : "pointer",
                opacity: envoi || brouillon.trim().length === 0 ? 0.6 : 1,
              }}
            >
              {envoi ? "Envoi…" : "Envoyer"}
            </button>
          </div>
          {erreurEnvoi && (
            <p role="alert" style={{ color: "#c0392b", fontSize: 12, margin: 0 }}>
              {erreurEnvoi}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
