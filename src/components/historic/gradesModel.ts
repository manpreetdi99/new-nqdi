import type { HistoricGradeKey, HistoricGradeRow } from "@/lib/api";

/**
 * Η αριθμητική των GRADES του .pbix (σελίδες [02] GRADES και [33]–[36] Comparison GRADES):
 *
 *   CF Voice = 10 × VoiceWeight / (GSM × 150 + FREE × 250)
 *   CF Data  = 10 × (100 − VoiceWeight) / (HTTP × 100 + CAP × 275 + Browsing × 100 + YT × 100 + Ping × 25)
 *   weight_X = base_X × slider_X × CF(group)            (μέγιστοι πόντοι της υπηρεσίας)
 *   Grade X  = SUB_SCORE_X × weight_X
 *   Visuals Total Score = Σ WEIGHT × Σ_X Grade X / Σ WEIGHT   (WEIGHT = βάρος κατηγορίας περιοχής)
 *
 * Στα defaults (Voice 40, όλα τα άλλα 50) το αποτέλεσμα == TOTAL_SCORE του warehouse.
 */

export interface ServiceSpec {
  key: HistoricGradeKey;
  label: string;
  base: number;
  group: "voice" | "data";
}

export const SERVICES: ServiceSpec[] = [
  { key: "gsm", label: "Voice GSM (M→F)", base: 150, group: "voice" },
  { key: "free", label: "Voice Free (M→M)", base: 250, group: "voice" },
  { key: "http", label: "HTTP", base: 100, group: "data" },
  { key: "cap", label: "Capacity", base: 275, group: "data" },
  { key: "browsing", label: "Browsing", base: 100, group: "data" },
  { key: "yt", label: "YouTube", base: 100, group: "data" },
  { key: "ping", label: "Ping", base: 25, group: "data" },
];

export type Sliders = { voice: number } & Record<HistoricGradeKey, number>;

export const DEFAULT_SLIDERS: Sliders = { voice: 40, gsm: 50, free: 50, http: 50, cap: 50, browsing: 50, yt: 50, ping: 50 };

/** Μέγιστοι πόντοι ανά υπηρεσία για τα τρέχοντα sliders (Σ = 1000). */
export function serviceWeights(s: Sliders): Record<HistoricGradeKey, number> {
  const groupSum = (group: "voice" | "data") =>
    SERVICES.filter((x) => x.group === group).reduce((sum, x) => sum + x.base * s[x.key], 0);
  const cfVoice = groupSum("voice") ? (10 * s.voice) / groupSum("voice") : 0;
  const cfData = groupSum("data") ? (10 * (100 - s.voice)) / groupSum("data") : 0;
  const out = {} as Record<HistoricGradeKey, number>;
  SERVICES.forEach((x) => {
    out[x.key] = x.base * s[x.key] * (x.group === "voice" ? cfVoice : cfData);
  });
  return out;
}

export interface OperatorGrade {
  operator: string;
  total: number;
  voice: number;
  data: number;
  services: Record<HistoricGradeKey, number>;
}

/** Grade X ανά γραμμή (BLANK SUB_SCORE -> 0, όπως το SUMX του DAX) σταθμισμένο με WEIGHT. */
export function aggregate(rows: HistoricGradeRow[], weights: Record<HistoricGradeKey, number>): OperatorGrade | null {
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  if (!rows.length || !totalWeight) return null;
  const services = {} as Record<HistoricGradeKey, number>;
  SERVICES.forEach((x) => {
    services[x.key] = rows.reduce((s, r) => s + r.weight * (r.sub[x.key] ?? 0) * weights[x.key], 0) / totalWeight;
  });
  const voice = services.gsm + services.free;
  const data = services.http + services.cap + services.browsing + services.yt + services.ping;
  return { operator: rows[0].operator, total: voice + data, voice, data, services };
}
