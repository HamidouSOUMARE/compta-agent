// ---------------------------------------------------------------------------
// Lecture du TEXTE NATIF d'un PDF (pas d'OCR) via pdfjs-dist. On regroupe les
// fragments de texte par ligne (position Y) pour reconstruire les lignes
// libellées de la facture, condition d'une extraction fiable par regex.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
// Build "legacy" = compatible Node (pas d'APIs navigateur).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

interface TextItem {
  str: string;
  transform: number[]; // [a, b, c, d, e, f] -> e = x, f = y
}

/** Renvoie le texte natif d'un PDF, une ligne de facture par ligne de texte. */
export async function extractPdfText(filePath: string): Promise<string> {
  const data = new Uint8Array(await readFile(filePath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const out: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as TextItem[];

    // Regroupe par Y arrondi (une ligne), puis trie par X croissant.
    const lignes = new Map<number, TextItem[]>();
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const bucket = lignes.get(y) ?? [];
      bucket.push(it);
      lignes.set(y, bucket);
    }

    const ys = [...lignes.keys()].sort((a, b) => b - a); // haut -> bas
    for (const y of ys) {
      const ligne = lignes
        .get(y)!
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((it) => it.str)
        .join("")
        .trim();
      if (ligne) out.push(ligne);
    }
  }

  await doc.destroy();
  return out.join("\n");
}
