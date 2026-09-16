"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
//
// Pendant Admin de /client/communication — même table Message (voir
// GET/POST /api/clients/[id]/messages), même absence de threading. Le nom
// du client est relu depuis GET /api/clients (déjà existant, déjà
// utilisé par app/admin/clients/page.tsx) plutôt que de créer une route
// GET /api/clients/[id] uniquement pour un nom — API minimale.

type Message = { id: string; auteurRole: "CLIENT" | "ADMIN"; contenu: string; createdAt: string };
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
  const finDeListe = useRef<HTMLDivElement>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    finDeListe.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

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
    setEnvoi(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreurEnvoi(d.error ?? "Une erreur est survenue, réessayez.");
      return;
    }
    setBrouillon("");
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
          {erreurEnvoi && <p style={{ color: "#c0392b", fontSize: 12, margin: 0 }}>{erreurEnvoi}</p>}
        </div>
      </div>
    </div>
  );
}
