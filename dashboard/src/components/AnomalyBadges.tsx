import type { Anomalie } from "../../../src/types";

const LIBELLES: Record<string, string> = {
  SIREN_INVALIDE: "SIREN invalide",
  TVA_INCOHERENTE: "TVA incohérente",
  TTC_INCOHERENT: "TTC incohérent",
  DOUBLON: "Doublon",
  MENTION_MANQUANTE: "Mention manquante",
  COMPTE_AMBIGU: "Compte ambigu",
  TVA_NON_DEDUCTIBLE: "TVA non déductible",
  TVA_A_VERIFIER: "TVA à vérifier",
  IMMOBILISATION: "Immobilisation",
  AUTOLIQUIDATION: "Autoliquidation",
};

export function AnomalyBadges({ anomalies }: { anomalies: Anomalie[] }) {
  if (anomalies.length === 0) return <span className="badge auto">Conforme</span>;
  return (
    <span className="badges">
      {anomalies.map((a, i) => (
        <span key={i} className={`badge ${a.gravite}`} title={a.message}>
          {LIBELLES[a.code] ?? a.code}
        </span>
      ))}
    </span>
  );
}
