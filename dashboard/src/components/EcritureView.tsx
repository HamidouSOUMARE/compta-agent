import type { DossierFacture } from "../../../src/types";
import { AnomalyBadges } from "./AnomalyBadges";

const eur = (n: number) =>
  n === 0 ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function EcritureView({ dossier }: { dossier: DossierFacture }) {
  const e = dossier.ecriture;
  return (
    <div className="detail">
      <h2>{dossier.fields.fournisseur ?? "Fournisseur inconnu"}</h2>
      <div className="file">{dossier.sourceFile.split("/").pop()}</div>

      <div style={{ marginTop: 12 }}>
        <span className={`badge ${dossier.statut === "auto-valide" ? "auto" : "revoir"}`}>
          {dossier.statut === "auto-valide" ? "Auto-validé" : "À revoir"}
        </span>{" "}
        <span className="motif" style={{ marginLeft: 4 }}>
          confiance {(dossier.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="section-title">Justification</div>
      <div className="justif">{dossier.justification}</div>
      <div className="motif">→ {dossier.motifRoutage}</div>

      <div className="section-title">Écriture proposée (journal {e.journal})</div>
      <table className="ecriture">
        <thead>
          <tr>
            <th>Compte</th>
            <th>Libellé</th>
            <th style={{ textAlign: "right" }}>Débit</th>
            <th style={{ textAlign: "right" }}>Crédit</th>
          </tr>
        </thead>
        <tbody>
          {e.lignes.map((l, i) => (
            <tr key={i}>
              <td className="compte">{l.compte}</td>
              <td className="lib">{l.libelle}</td>
              <td className="amount">{eur(l.debit)}</td>
              <td className="amount">{eur(l.credit)}</td>
            </tr>
          ))}
          <tr className="total">
            <td colSpan={2}>Totaux</td>
            <td className="amount">{eur(e.totalDebit)}</td>
            <td className="amount">{eur(e.totalCredit)}</td>
          </tr>
        </tbody>
      </table>
      <div className="equilibre">
        {e.equilibre ? (
          <span className="badge auto">Équilibré ✓ (débit = crédit)</span>
        ) : (
          <span className="badge bloquante">Déséquilibré ✗</span>
        )}
      </div>

      <div className="section-title">Anomalies</div>
      <AnomalyBadges anomalies={dossier.anomalies} />

      <div className="section-title">Champs extraits</div>
      <table className="ecriture">
        <tbody>
          <tr><td className="lib">SIREN</td><td>{dossier.fields.siren ?? "—"}</td></tr>
          <tr><td className="lib">TVA intra</td><td>{dossier.fields.tvaIntra ?? "—"}</td></tr>
          <tr><td className="lib">N° facture</td><td>{dossier.fields.numeroFacture ?? "—"}</td></tr>
          <tr><td className="lib">Date</td><td>{dossier.fields.dateFacture ?? "—"}</td></tr>
          <tr><td className="lib">Désignation</td><td>{dossier.fields.designation ?? "—"}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
