import crypto from "crypto";

const LONGUEUR_MIN = 8;

// Vérifie qu'un mot de passe respecte la longueur minimale, puis s'il ne
// figure pas dans une fuite de données connue (API "Pwned Passwords" de
// HaveIBeenPwned, en k-anonymat : seuls les 5 premiers caractères du hash
// SHA-1 sont envoyés, jamais le mot de passe ni son hash complet — voir
// https://haveibeenpwned.com/API/v3#PwnedPasswords). Gratuite, sans clé.
// Best-effort : si l'API est indisponible, on n'empêche pas l'inscription
// pour autant (dégradation silencieuse plutôt que blocage total).
export async function validerMotDePasse(
  motDePasse: string
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  if (!motDePasse || motDePasse.length < LONGUEUR_MIN) {
    return { ok: false, erreur: `Le mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères.` };
  }

  try {
    const hash = crypto.createHash("sha1").update(motDePasse, "utf8").digest("hex").toUpperCase();
    const prefixe = hash.slice(0, 5);
    const suffixe = hash.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefixe}`, {
      headers: { "Add-Padding": "true" },
      // Le contrôle ne doit jamais faire attendre indéfiniment l'inscription.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: true };

    const corps = await res.text();
    const trouve = corps
      .split("\n")
      .some((ligne) => ligne.split(":")[0].trim().toUpperCase() === suffixe);

    if (trouve) {
      return {
        ok: false,
        erreur:
          "Ce mot de passe apparaît dans une fuite de données connue — merci d'en choisir un autre pour votre sécurité.",
      };
    }
    return { ok: true };
  } catch {
    // API indisponible/timeout : on ne bloque pas l'inscription pour ça.
    return { ok: true };
  }
}
