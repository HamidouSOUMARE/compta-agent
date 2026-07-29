// ---------------------------------------------------------------------------
// Génère ~19 factures fournisseurs en PDF TEXTE NATIF (pas d'image, pas d'OCR).
// Cas propres + doublon + TVA incohérente + SIREN invalide + mention manquante
// + restauration + carburant + immobilisation + saucissonnage + intracom.
// ---------------------------------------------------------------------------

import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { completeSiren, tvaIntraFR, luhnCheck } from "../src/lib/siren.js";
import { INVOICES_DIR } from "../src/store.js";

interface Ligne {
  taux: number;
  montant: number;
}

interface Spec {
  file: string;
  numero: string;
  date: string; // DD/MM/YYYY
  fournisseur: string;
  adresse: string;
  pays?: string; // défaut FR
  sirenMode: "valid" | "invalid" | "none";
  sirenBase8?: string;
  tvaIntra?: "auto" | "none" | string;
  designation: string;
  ht: number | null;
  tva: Ligne[];
  ttc: number;
  note: string; // rappel du cas testé (commentaire seed uniquement)
}

const fr = (n: number) => n.toFixed(2).replace(".", ",");
/** Taux affiché sans zéros inutiles : 20 -> "20", 5.5 -> "5,5". */
const tauxLabel = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));

/** SIREN volontairement faux : clé de Luhn incorrecte. */
function makeInvalidSiren(base8: string): string {
  const valide = completeSiren(base8);
  for (let k = 0; k <= 9; k++) {
    const candidat = base8 + k;
    if (candidat !== valide && !luhnCheck(candidat)) return candidat;
  }
  throw new Error("pas de SIREN invalide trouvé");
}

function resolveSiren(spec: Spec): string | null {
  if (spec.sirenMode === "none") return null;
  const base = spec.sirenBase8 ?? "73282932";
  return spec.sirenMode === "valid" ? completeSiren(base) : makeInvalidSiren(base);
}

const SPECS: Spec[] = [
  // --- 9 cas propres variés ---
  {
    file: "01_marchandises_textile.pdf", numero: "FAC-2026-001", date: "12/03/2026",
    fournisseur: "Textile Gros SARL", adresse: "12 rue du Commerce, 75011 Paris",
    sirenMode: "valid", sirenBase8: "40123456", tvaIntra: "auto",
    designation: "Achat de marchandises textiles pour revente",
    ht: 1250, tva: [{ taux: 20, montant: 250 }], ttc: 1500, note: "607 propre",
  },
  {
    file: "02_fournitures_papeterie.pdf", numero: "FAC-2026-002", date: "05/03/2026",
    fournisseur: "Papeterie Centrale", adresse: "8 avenue des Ecoles, 69003 Lyon",
    sirenMode: "valid", sirenBase8: "51234501", tvaIntra: "auto",
    designation: "Fournitures administratives et papeterie",
    ht: 180, tva: [{ taux: 20, montant: 36 }], ttc: 216, note: "606 propre",
  },
  {
    file: "03_loyer_bail.pdf", numero: "FAC-2026-003", date: "01/03/2026",
    fournisseur: "SCI Les Tilleuls", adresse: "3 place Bellecour, 69002 Lyon",
    sirenMode: "valid", sirenBase8: "60234512", tvaIntra: "auto",
    designation: "Loyer bail commercial mars 2026",
    ht: 900, tva: [{ taux: 20, montant: 180 }], ttc: 1080, note: "613 propre",
  },
  {
    file: "04_honoraires_ec.pdf", numero: "FAC-2026-004", date: "15/03/2026",
    fournisseur: "Cabinet Durand Expertise", adresse: "24 rue de la Paix, 75002 Paris",
    sirenMode: "valid", sirenBase8: "70345623", tvaIntra: "auto",
    designation: "Honoraires expert-comptable mensuels",
    ht: 600, tva: [{ taux: 20, montant: 120 }], ttc: 720, note: "622 propre",
  },
  {
    file: "05_telecom.pdf", numero: "FAC-2026-005", date: "20/03/2026",
    fournisseur: "Orange Business", adresse: "1 avenue Nelson Mandela, 94110 Arcueil",
    sirenMode: "valid", sirenBase8: "38012986", tvaIntra: "auto",
    designation: "Abonnement telephone et internet professionnel",
    ht: 45, tva: [{ taux: 20, montant: 9 }], ttc: 54, note: "626 propre",
  },
  {
    file: "06_marchandises_tva55.pdf", numero: "FAC-2026-006", date: "22/03/2026",
    fournisseur: "Primeur des Halles", adresse: "15 rue Rambuteau, 75004 Paris",
    sirenMode: "valid", sirenBase8: "41456712", tvaIntra: "auto",
    designation: "Achat de marchandises alimentaires pour revente",
    ht: 800, tva: [{ taux: 5.5, montant: 44 }], ttc: 844, note: "607 TVA 5,5% (taux valide mais rare)",
  },
  {
    file: "07_entretien.pdf", numero: "FAC-2026-007", date: "18/03/2026",
    fournisseur: "Plomberie Martin", adresse: "6 rue des Artisans, 33000 Bordeaux",
    sirenMode: "valid", sirenBase8: "42567823", tvaIntra: "auto",
    designation: "Reparation et entretien plomberie des locaux",
    ht: 320, tva: [{ taux: 20, montant: 64 }], ttc: 384, note: "615 propre",
  },
  {
    file: "08_energie_edf.pdf", numero: "FAC-2026-008", date: "25/03/2026",
    fournisseur: "EDF Entreprises", adresse: "22 avenue de Wagram, 75008 Paris",
    sirenMode: "valid", sirenBase8: "55208131", tvaIntra: "auto",
    designation: "Fourniture electricite energie des locaux",
    ht: 210, tva: [{ taux: 20, montant: 42 }], ttc: 252, note: "606 energie propre",
  },
  {
    file: "09_honoraires_avocat.pdf", numero: "FAC-2026-009", date: "28/03/2026",
    fournisseur: "Maitre Lefevre Avocat", adresse: "10 rue du Palais, 13001 Marseille",
    sirenMode: "valid", sirenBase8: "43678934", tvaIntra: "auto",
    designation: "Honoraires conseil juridique",
    ht: 1500, tva: [{ taux: 20, montant: 300 }], ttc: 1800, note: "622 propre",
  },

  // --- Cas à anomalies ---
  {
    file: "10_doublon.pdf", numero: "FAC-2026-001", date: "12/03/2026",
    fournisseur: "Textile Gros SARL", adresse: "12 rue du Commerce, 75011 Paris",
    sirenMode: "valid", sirenBase8: "40123456", tvaIntra: "auto",
    designation: "Achat de marchandises textiles pour revente",
    ht: 1250, tva: [{ taux: 20, montant: 250 }], ttc: 1500, note: "DOUBLON de la 01",
  },
  {
    file: "11_tva_incoherente.pdf", numero: "FAC-2026-011", date: "10/03/2026",
    fournisseur: "Bureautique Plus", adresse: "5 rue Neuve, 59000 Lille",
    sirenMode: "valid", sirenBase8: "44789045", tvaIntra: "auto",
    designation: "Fournitures diverses d'atelier",
    ht: 500, tva: [{ taux: 20, montant: 100 }], ttc: 620, note: "HT+TVA=600 != TTC 620",
  },
  {
    file: "12_siren_invalide.pdf", numero: "FAC-2026-012", date: "11/03/2026",
    fournisseur: "Distrib Rapide", adresse: "9 zone industrielle, 44000 Nantes",
    sirenMode: "invalid", sirenBase8: "12345678", tvaIntra: "none",
    designation: "Achat de marchandises pour revente",
    ht: 400, tva: [{ taux: 20, montant: 80 }], ttc: 480, note: "SIREN echoue au Luhn",
  },
  {
    file: "13_mention_manquante.pdf", numero: "FAC-2026-013", date: "14/03/2026",
    fournisseur: "Import Direct", adresse: "2 rue du Port, 76600 Le Havre",
    sirenMode: "valid", sirenBase8: "45890156", tvaIntra: "none",
    designation: "Achat de marchandises pour revente",
    ht: 750, tva: [{ taux: 20, montant: 150 }], ttc: 900, note: "pas de TVA intra, TTC>150 -> TVA non deductible",
  },
  {
    file: "14_restauration.pdf", numero: "FAC-2026-014", date: "16/03/2026",
    fournisseur: "Restaurant Le Gourmet", adresse: "18 rue Gambetta, 21000 Dijon",
    sirenMode: "valid", sirenBase8: "46901267", tvaIntra: "auto",
    designation: "Repas d'affaires et reception clients",
    ht: 120, tva: [{ taux: 10, montant: 12 }], ttc: 132, note: "625 TVA a verifier",
  },
  {
    file: "15_carburant.pdf", numero: "FAC-2026-015", date: "19/03/2026",
    fournisseur: "Station Total Access", adresse: "A6 aire de repos, 71000 Macon",
    sirenMode: "valid", sirenBase8: "47012378", tvaIntra: "auto",
    designation: "Carburant essence sans plomb 95 - vehicule de tourisme",
    ht: 80, tva: [{ taux: 20, montant: 16 }], ttc: 96, note: "carburant VP -> TVA deductible 80% (prorata)",
  },
  {
    file: "16_immo_ordinateur.pdf", numero: "FAC-2026-016", date: "21/03/2026",
    fournisseur: "InfoTech Distribution", adresse: "30 rue Technologie, 31000 Toulouse",
    sirenMode: "valid", sirenBase8: "48123489", tvaIntra: "auto",
    designation: "Ordinateur portable professionnel",
    ht: 1200, tva: [{ taux: 20, montant: 240 }], ttc: 1440, note: "immo claire 218300 + TVA 445620",
  },
  {
    file: "17_mobilier_saucissonne.pdf", numero: "FAC-2026-017", date: "23/03/2026",
    fournisseur: "Mobilier Pro", adresse: "40 rue de l'Ameublement, 59100 Roubaix",
    sirenMode: "valid", sirenBase8: "49234590", tvaIntra: "auto",
    designation: "Lot de 20 chaises de bureau ergonomiques",
    ht: 1800, tva: [{ taux: 20, montant: 360 }], ttc: 2160, note: "saucissonnage -> immo 218400",
  },
  {
    file: "18_intracom_autoliquidation.pdf", numero: "FAC-2026-018", date: "24/03/2026",
    fournisseur: "Berlin Software GmbH", adresse: "Unter den Linden 5, 10117 Berlin",
    pays: "DE", sirenMode: "none", tvaIntra: "DE811569869",
    designation: "Prestation de conseil et developpement logiciel",
    ht: 2000, tva: [], ttc: 2000, note: "intracom sans TVA -> autoliquidation",
  },
  {
    file: "19_remorque_transport.pdf", numero: "FAC-2026-019", date: "26/03/2026",
    fournisseur: "Remorques Sud", adresse: "12 route Nationale, 34000 Montpellier",
    sirenMode: "valid", sirenBase8: "50345601", tvaIntra: "auto",
    designation: "Remorque utilitaire 750 kg",
    ht: 480, tva: [{ taux: 20, montant: 96 }], ttc: 576, note: "transport -> immo 218200 malgre < 500",
  },
  {
    file: "20_vehicule_tourisme.pdf", numero: "FAC-2026-020", date: "27/03/2026",
    fournisseur: "Garage Central Auto", adresse: "45 boulevard Voltaire, 75011 Paris",
    sirenMode: "valid", sirenBase8: "51456712", tvaIntra: "auto",
    designation: "Achat vehicule de tourisme Peugeot 308",
    ht: 15000, tva: [{ taux: 20, montant: 3000 }], ttc: 18000,
    note: "achat VP -> TVA 0% integralement reintegree (immo 218200)",
  },
];

async function renderInvoice(spec: Spec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const siren = resolveSiren(spec);
  const pays = spec.pays ?? "FR";
  let tvaIntra: string | null = null;
  if (spec.tvaIntra === "auto" && siren) tvaIntra = tvaIntraFR(siren);
  else if (spec.tvaIntra && spec.tvaIntra !== "auto" && spec.tvaIntra !== "none") tvaIntra = spec.tvaIntra;

  const lines: { text: string; f?: typeof font; size?: number }[] = [
    { text: "FACTURE", f: bold, size: 18 },
    { text: "" },
    { text: `N° facture : ${spec.numero}` },
    { text: `Date : ${spec.date}` },
    { text: "" },
    { text: `Fournisseur : ${spec.fournisseur}`, f: bold },
    { text: `Adresse : ${spec.adresse}` },
    { text: `Pays : ${pays}` },
    ...(siren ? [{ text: `SIREN : ${siren}` }] : []),
    ...(tvaIntra ? [{ text: `N° TVA Intracommunautaire : ${tvaIntra}` }] : []),
    { text: "" },
    { text: `Désignation : ${spec.designation}` },
    { text: "" },
    { text: `Montant HT : ${spec.ht != null ? fr(spec.ht) : "-"} EUR` },
    ...spec.tva.map((t) => ({ text: `TVA ${tauxLabel(t.taux)}% : ${fr(t.montant)} EUR` })),
    ...(spec.tva.length === 0 ? [{ text: "TVA : 0,00 EUR (autoliquidation - article 283-2 du CGI)" }] : []),
    { text: `Total TTC : ${fr(spec.ttc)} EUR`, f: bold },
  ];

  let y = 790;
  for (const l of lines) {
    if (l.text) {
      page.drawText(l.text, {
        x: 50,
        y,
        size: l.size ?? 11,
        font: l.f ?? font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    y -= (l.size ?? 11) + 8;
  }

  // useObjectStreams:false -> PDF lisible par le vieux pdf.js embarqué dans pdf-parse.
  return doc.save({ useObjectStreams: false });
}

async function main() {
  await mkdir(INVOICES_DIR, { recursive: true });
  for (const spec of SPECS) {
    const bytes = await renderInvoice(spec);
    await writeFile(`${INVOICES_DIR}/${spec.file}`, bytes);
    console.log(`📄 ${spec.file}  (${spec.note})`);
  }
  console.log(`\n✅ ${SPECS.length} factures générées dans data/invoices/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
