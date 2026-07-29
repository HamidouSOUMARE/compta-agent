// Charge le livrable produit par `npm run demo`. L'import JSON est statique :
// relancer la démo régénère le fichier et Vite recharge la page (HMR).
import batch from "../../data/output/ecritures.json";
import type { BatchResult } from "../../src/types";

export const BATCH = batch as unknown as BatchResult;
