// ---------------------------------------------------------------------------
// Arithmétique de la TVA : arrondi comptable, cohérence HT+TVA=TTC,
// vérification que le taux appliqué correspond à un taux légal.
// ---------------------------------------------------------------------------

import { TAUX_TVA_VALIDES } from "../config.js";

const TOLERANCE = 0.01;

/** Arrondi à 2 décimales (centime d'euro). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** |a - b| <= 0,01 €. */
export function equalsTo2(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) <= TOLERANCE;
}

/** Vrai si HT + Σ TVA = TTC à ± 0,01 €. */
export function ttcCoherent(ht: number, totalTva: number, ttc: number): boolean {
  return equalsTo2(ht + totalTva, ttc);
}

/** Le taux est-il l'un des taux légaux ? */
export function isTauxValide(taux: number): boolean {
  return TAUX_TVA_VALIDES.some((t) => equalsTo2(t, taux));
}

/**
 * Contrôle qu'un montant de TVA correspond bien à un taux légal appliqué à une
 * base HT. Renvoie le taux effectif calculé (TVA / HT * 100) et sa validité.
 */
export function verifierTauxSurBase(
  baseHT: number,
  montantTva: number
): { tauxEffectif: number; valide: boolean } {
  if (baseHT <= 0) return { tauxEffectif: 0, valide: montantTva === 0 };
  const tauxEffectif = round2((montantTva / baseHT) * 100);
  // On accepte une petite dérive d'arrondi autour d'un taux légal.
  const valide = TAUX_TVA_VALIDES.some(
    (t) => Math.abs(t - tauxEffectif) <= 0.15
  );
  return { tauxEffectif, valide };
}
