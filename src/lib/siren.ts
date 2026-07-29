// ---------------------------------------------------------------------------
// Validation du SIREN (9 chiffres) par l'algorithme de Luhn, et calcul de la
// clé du numéro de TVA intracommunautaire français.
// ---------------------------------------------------------------------------

/** Vrai si `siren` est composé de 9 chiffres et vérifie la clé de Luhn. */
export function isValidSiren(siren: string | null | undefined): boolean {
  if (!siren) return false;
  const digits = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(digits)) return false;
  return luhnCheck(digits);
}

/** Somme de Luhn ≡ 0 [10]. */
export function luhnCheck(value: string): boolean {
  let sum = 0;
  // On double un chiffre sur deux en partant de la droite.
  for (let i = 0; i < value.length; i++) {
    const posFromRight = value.length - 1 - i;
    let d = Number(value[i]);
    if (posFromRight % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Complète 8 chiffres avec la clé de Luhn pour produire un SIREN valide (seed). */
export function completeSiren(base8: string): string {
  if (!/^\d{8}$/.test(base8)) throw new Error("base8 doit contenir 8 chiffres");
  for (let key = 0; key <= 9; key++) {
    const candidate = base8 + key;
    if (luhnCheck(candidate)) return candidate;
  }
  throw new Error("clé de Luhn introuvable");
}

/** Clé du n° de TVA intra FR : (12 + 3 * (SIREN mod 97)) mod 97. */
export function tvaIntraFR(siren: string): string {
  const n = Number(siren) % 97;
  const key = (12 + 3 * n) % 97;
  return `FR${key.toString().padStart(2, "0")}${siren}`;
}
