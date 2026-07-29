// ---------------------------------------------------------------------------
// Export type FEC (Fichier des Écritures Comptables). On produit un CSV avec
// les colonnes essentielles : Journal, Date, Compte, Libellé, Débit, Crédit.
// Le vrai FEC (art. A47 A-1 du LPF) compte 18 champs ; on en expose un
// sous-ensemble lisible pour la démo, séparateur point-virgule.
// ---------------------------------------------------------------------------

import type { DossierFacture } from "../types.js";

const SEP = ";";

/** Formate un montant à la française pour le FEC : "1234,56" (virgule décimale). */
function montantFEC(n: number): string {
  if (!n) return "0,00";
  return n.toFixed(2).replace(".", ",");
}

/** Date ISO -> AAAAMMJJ (format FEC EcritureDate). */
function dateFEC(iso: string | null): string {
  if (!iso) return "";
  return iso.replace(/-/g, "");
}

function echapper(champ: string): string {
  if (champ.includes(SEP) || champ.includes('"') || champ.includes("\n")) {
    return `"${champ.replace(/"/g, '""')}"`;
  }
  return champ;
}

/**
 * Sérialise les écritures AUTO-VALIDÉES en CSV type FEC. Les pièces "à revoir"
 * sont exclues : l'agent ne comptabilise jamais ce qui n'est pas validé.
 */
export function toFecCsv(dossiers: DossierFacture[]): string {
  const header = [
    "JournalCode",
    "EcritureDate",
    "CompteNum",
    "EcritureLib",
    "PieceRef",
    "Debit",
    "Credit",
  ].join(SEP);

  const lignes: string[] = [header];
  let ecritureNum = 0;

  for (const d of dossiers) {
    if (d.statut !== "auto-valide") continue;
    ecritureNum++;
    for (const l of d.ecriture.lignes) {
      lignes.push(
        [
          d.ecriture.journal,
          dateFEC(d.ecriture.date),
          l.compte,
          echapper(l.libelle),
          echapper(d.ecriture.numeroPiece ?? `PIECE-${ecritureNum}`),
          montantFEC(l.debit),
          montantFEC(l.credit),
        ].join(SEP)
      );
    }
  }

  return lignes.join("\r\n") + "\r\n";
}
