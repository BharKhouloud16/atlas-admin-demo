import zlib from "zlib";

// pdf-lib compresse les flux de contenu (FlateDecode) : chercher le code
// devise directement dans les octets bruts du PDF ne fonctionne pas — il
// faut décompresser chaque flux "stream...endstream" pour retrouver le
// contenu réellement dessiné. Pas de nouvelle dépendance : zlib est un
// module Node natif.
//
// Une fois décompressé, le texte n'apparaît toujours pas en clair : pdf-lib
// dessine chaque ligne avec l'opérateur Tj sous forme de chaîne
// HEXADÉCIMALE "<...>" (un octet par caractère, encodage WinAnsi de la
// police Helvetica de base), jamais une chaîne littérale "(...)". Il faut
// donc aussi décoder chaque chaîne hexadécimale pour retrouver le texte —
// confirmé par l'échec du run CI #37, qui montrait la chaîne hex brute
// (ex. "<41544C4153...>") au lieu du texte attendu.
export function extraireTexteBrutPdf(pdfBytes: Buffer): string {
  const contenu = pdfBytes.toString("latin1");
  const morceaux: string[] = [];
  const regexStream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = regexStream.exec(contenu))) {
    let texte: string;
    try {
      texte = zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      // pas un flux FlateDecode (ex. police déjà binaire) — ignoré
      continue;
    }
    const regexHex = /<([0-9A-Fa-f]+)>/g;
    let h: RegExpExecArray | null;
    while ((h = regexHex.exec(texte))) {
      morceaux.push(Buffer.from(h[1], "hex").toString("latin1"));
    }
  }
  return morceaux.join(" ");
}
