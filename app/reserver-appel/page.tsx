"use client";

import { useState } from "react";
import Link from "next/link";

// Formulaire public de reservation d'appel / contact -- volontairement SANS
// creation de compte : un prospect ne doit pas s'inscrire pour prendre
// rendez-vous. On ne collecte que le minimum d'informations necessaires ;
// l'equipe Atlas recontacte ensuite pour caler l'appel (voir
// app/api/demandes-contact/route.ts et app/admin/demandes/page.tsx).

const bleu = "#2557d6";
const bleuFonce = "#12224a";
const grisTexte = "#4b5567";
const bordure = "#e4e7ee";

const CRENEAUX = [
"Des que possible",
"Cette semaine",
"Semaine prochaine",
"Dans le mois",
"Pas de preference",
];

export default function ReserverAppelPage() {
const [nom, setNom] = useState("");
const [email, setEmail] = useState("");
const [entreprise, setEntreprise] = useState("");
const [telephone, setTelephone] = useState("");
const [creneauSouhaite, setCreneauSouhaite] = useState(CRENEAUX[0]);
const [message, setMessage] = useState("");
const [envoi, setEnvoi] = useState(false);
const [erreur, setErreur] = useState("");
const [envoye, setEnvoye] = useState(false);

async function envoyer(e: React.FormEvent) {
e.preventDefault();
setErreur("");

if (!nom.trim()) {
setErreur("Merci d'indiquer votre nom.");
return;
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
setErreur("Merci d'indiquer une adresse email valide.");
return;
}

setEnvoi(true);
try {
const res = await fetch("/api/demandes-contact", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ nom, email, entreprise, telephone, creneauSouhaite, message }),
});
if (!res.ok) {
const data = await res.json().catch(() => null);
setErreur(data?.error ?? "Une erreur est survenue. Merci de reessayer.");
setEnvoi(false);
return;
}
setEnvoye(true);
} catch {
setErreur("Une erreur est survenue. Merci de reessayer.");
setEnvoi(false);
}
}

if (envoye) {
return (
<main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center", color: bleuFonce }}>
<div
style={{
width: 56,
height: 56,
borderRadius: "50%",
background: "#e8f6ee",
color: "#16a34a",
display: "flex",
alignItems: "center",
justifyContent: "center",
fontSize: 26,
margin: "0 auto 20px",
}}
>
OK
</div>
<h1 style={{ fontSize: 24, marginBottom: 12 }}>Merci, votre demande est bien enregistree</h1>
<p style={{ color: grisTexte, lineHeight: 1.6, marginBottom: 28 }}>
Notre equipe vous recontacte sous 24h ouvrees pour caler ensemble un creneau de 30 minutes.
</p>
<Link href="/" style={{ color: bleu, fontWeight: 600, textDecoration: "none" }}>
Retour a l&apos;accueil
</Link>
</main>
);
}

return (
<main style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px", color: bleuFonce }}>
<Link href="/" style={{ color: grisTexte, fontSize: 13, textDecoration: "none" }}>
Retour a l&apos;accueil
</Link>

<h1 style={{ fontSize: 28, margin: "16px 0 8px" }}>Reserver un appel de 30 minutes</h1>
<p style={{ color: grisTexte, lineHeight: 1.6, marginBottom: 28 }}>
Aucune creation de compte n&apos;est necessaire. Laissez-nous quelques informations, notre equipe vous
recontacte pour fixer l&apos;horaire qui vous convient.
</p>

<form onSubmit={envoyer} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
<Champ label="Nom *">
<input
value={nom}
onChange={(e) => setNom(e.target.value)}
style={inputStyle}
placeholder="Votre nom"
/>
</Champ>

<Champ label="Email professionnel *">
<input
type="email"
value={email}
onChange={(e) => setEmail(e.target.value)}
style={inputStyle}
placeholder="vous@entreprise.com"
/>
</Champ>

<Champ label="Entreprise">
<input
value={entreprise}
onChange={(e) => setEntreprise(e.target.value)}
style={inputStyle}
placeholder="Nom de votre entreprise"
/>
</Champ>

<Champ label="Telephone (optionnel)">
<input
value={telephone}
onChange={(e) => setTelephone(e.target.value)}
style={inputStyle}
placeholder="+33 6 12 34 56 78"
/>
</Champ>

<Champ label="Creneau souhaite">
<select value={creneauSouhaite} onChange={(e) => setCreneauSouhaite(e.target.value)} style={inputStyle}>
{CRENEAUX.map((c) => (
<option key={c} value={c}>
{c}
</option>
))}
</select>
</Champ>

<Champ label="Message (optionnel)">
<textarea
value={message}
onChange={(e) => setMessage(e.target.value)}
style={{ ...inputStyle, minHeight: 90, resize: "vertical", fontFamily: "inherit" }}
placeholder="Votre besoin en quelques mots..."
/>
</Champ>

{erreur && (
<p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>{erreur}</p>
)}

<button
type="submit"
disabled={envoi}
style={{
marginTop: 8,
padding: "12px 20px",
borderRadius: 8,
border: "none",
background: envoi ? "#8fa6e6" : bleu,
color: "#fff",
fontWeight: 600,
fontSize: 15,
cursor: envoi ? "default" : "pointer",
}}
>
{envoi ? "Envoi en cours..." : "Envoyer ma demande"}
</button>
</form>
</main>
);
}

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
return (
<label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: grisTexte }}>
{label}
{children}
</label>
);
}

const inputStyle: React.CSSProperties = {
padding: "10px 12px",
borderRadius: 8,
border: `1px solid ${bordure}`,
fontSize: 14,
color: bleuFonce,
};
