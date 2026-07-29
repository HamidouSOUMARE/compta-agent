// ---------------------------------------------------------------------------
// Persistance légère en JSON local (pas de base lourde) + export FEC.
// ---------------------------------------------------------------------------

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BatchResult } from "./types.js";
import { toFecCsv } from "./lib/fec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const INVOICES_DIR = resolve(ROOT, "data/invoices");
export const OUTPUT_DIR = resolve(ROOT, "data/output");
export const ECRITURES_JSON = resolve(OUTPUT_DIR, "ecritures.json");
export const FEC_CSV = resolve(OUTPUT_DIR, "fec-export.csv");

/** Écrit ecritures.json (livrable dashboard) et fec-export.csv (livrable FEC). */
export async function persistBatch(batch: BatchResult): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(ECRITURES_JSON, JSON.stringify(batch, null, 2), "utf8");
  await writeFile(FEC_CSV, toFecCsv(batch.dossiers), "utf8");
}
