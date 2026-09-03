"use client";

import { useEffect, useState } from "react";

type Demande = {
id: string;
nom: string;
email: string;
entreprise: string | null;
telephone: string | null;
message: string | null;
creneauSouhaite: string | null;
traite: boolean;
createdAt: string;
};

// Demandes recues depuis le formulaire public /reserver-appel (voir
// app/api/demandes-contact/route.ts) -- aucune n'est liee a un compte, un
// prospect n'a pas eu besoin de s'inscrire. On les traite ici : marquer
// "traite" une fois l'appel cale avec le prospect.
export default function DemandesPage() {
const [demandes, setDemandes] = useState<Demande[]>([]);
const [chargement, setChargement] = useState(true);

useEffect(() => {
charger();
}, []);

function charger() {
fetch("/api/demandes-contact")
.then((r) => r.json())
.then((data) => {
setDemandes(Array.isArray(data) ? data : []);
setChargement(false);
});
}

async function basculerTraite(d: Demande) {
setDemandes((prev) => prev.map((x) => (x.id === d.id ? { ...x, traite: !x.traite } : x)));
await fetch("/api/demandes-contact", {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ id: d.id, traite: !d.traite }),
});
}

if (chargement) {
return <div>Chargement...</div>;
}

const enAttente = demandes.filter((d) => !d.traite);
const traitees = demandes.filter((d) => d.traite);

return (
<div>
<h1>Demandes de contact</h1>
<p style={{ fontSize: 13, color: "#666", marginBottom: 16, maxWidth: 720 }}>
Reservations d&apos;appel et messages recus depuis le site public, sans creation de compte. A traiter :
recontacter le prospect pour caler l&apos;appel, puis marquer comme traite.
</p>

{demandes.length === 0 && (
<p style={{ fontSize: 13, color: "#888" }}>Aucune demande pour l&apos;instant.</p>
)}

{enAttente.length > 0 && (
<>
<h2 style={{ fontSize: 16, marginTop: 24 }}>En attente ({enAttente.length})</h2>
<TableDemandes demandes={enAttente} onBasculer={basculerTraite} />
</>
)}

{traitees.length > 0 && (
<>
<h2 style={{ fontSize: 16, marginTop: 32 }}>Traitees ({traitees.length})</h2>
<TableDemandes demandes={traitees} onBasculer={basculerTraite} />
</>
)}
</div>
);
}

function TableDemandes({ demandes, onBasculer }: { demandes: Demande[]; onBasculer: (d: Demande) => void }) {
return (
<div style={{ overflowX: "auto" }}>
<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
<thead>
<tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
<th style={{ padding: "6px 8px" }}>Nom</th>
<th style={{ padding: "6px 8px" }}>Email</th>
<th style={{ padding: "6px 8px" }}>Entreprise</th>
<th style={{ padding: "6px 8px" }}>Telephone</th>
<th style={{ padding: "6px 8px" }}>Creneau souhaite</th>
<th style={{ padding: "6px 8px" }}>Message</th>
<th style={{ padding: "6px 8px" }}>Recue le</th>
<th style={{ padding: "6px 8px" }}></th>
</tr>
</thead>
<tbody>
{demandes.map((d) => (
<tr key={d.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
<td style={{ padding: "6px 8px" }}>{d.nom}</td>
<td style={{ padding: "6px 8px" }}>{d.email}</td>
<td style={{ padding: "6px 8px" }}>{d.entreprise ?? "-"}</td>
<td style={{ padding: "6px 8px" }}>{d.telephone ?? "-"}</td>
<td style={{ padding: "6px 8px" }}>{d.creneauSouhaite ?? "-"}</td>
<td style={{ padding: "6px 8px", maxWidth: 240 }}>{d.message ?? "-"}</td>
<td style={{ padding: "6px 8px" }}>{new Date(d.createdAt).toLocaleDateString("fr-FR")}</td>
<td style={{ padding: "6px 8px" }}>
<button
onClick={() => onBasculer(d)}
style={{
fontSize: 12,
padding: "4px 10px",
borderRadius: 6,
border: "1px solid #ccc",
background: d.traite ? "#fff" : "#16a34a",
color: d.traite ? "#333" : "#fff",
cursor: "pointer",
}}
>
{d.traite ? "Marquer non traite" : "Marquer traite"}
</button>
</td>
</tr>
))}
</tbody>
</table>
</div>
);
}
