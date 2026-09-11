/**
 * -----------------------------------------------------------------------------
 * servingPies — slices & χρώματα για τα δύο "Serving Band / Serving Technology" pies
 * -----------------------------------------------------------------------------
 * Ζει εκτός του SummaryTab ώστε να δοκιμάζεται χωρίς render (και να μη σπάει το
 * react-refresh, που θέλει τα component files να εξάγουν μόνο components).
 */

import { SERVING_BAND_TECH_METRICS, type ServingBandTechShare } from "@/lib/attachmentC";
import { CHART_PALETTE } from "@/lib/chartStyles";

export interface PieSlice {
  name: string;
  value: number;
  pct: number;
  color: string;
}

/** "Serving Technology (per Time) LTE CA (%)" -> "LTE CA" */
export const pieSliceName = (label: string): string =>
  label.replace(/^Serving (Band|Technology) \(per Time\) /, "").replace(/ \(%\)$/, "");

/**
 * CHART_PALETTE χωρίς το amber (index 2) — αποτυγχάνει το lightness-band check του
 * dataviz validator (βλ. `node scripts/validate_palette.js`). Το "LTE"/"LTE CA" με
 * τα δύο μπλε του technologyColor() επίσης αποτυγχάνουν το normal-vision floor
 * (ΔE 13.9 < 15, δύσκολο να ξεχωρίσουν ακόμα και με πλήρη έγχρωμη όραση) — γι' αυτό
 * τα δύο pies παίρνουν χρώμα από τη σταθερή σειρά του SERVING_BAND_TECH_METRICS,
 * ΟΧΙ το semantic technologyColor.
 */
export const PIE_PALETTE = CHART_PALETTE.filter((_, index) => index !== 2);
export const NO_DATA_COLOR = "#64748b";

/**
 * Χρώμα ανά ΜΕΤΡΙΚΗ, όχι ανά θέση μέσα στις μη-μηδενικές φέτες. Με το παλιό positional
 * index η ίδια τεχνολογία άλλαζε χρώμα από operator σε operator — όποιος δεν είχε 5G SA
 * "μάζευε" τις φέτες προς τα πάνω, οπότε το πράσινο ήταν "5G NR CA" στη μία στήλη και
 * "LTE-5GNR" στη διπλανή, και τα pies δεν συγκρίνονταν μεταξύ τους. Κλειδί το ord της
 * μετρικής: σταθερό, ανεξάρτητο από το ποιες γραμμές έχουν samples. Το "#NODATA" μένει
 * εκτός χάρτη επίτηδες — πέφτει στο ουδέτερο NO_DATA_COLOR αντί να πιάνει χρώμα παλέτας.
 *
 * Η παλέτα έχει 7 χρώματα και οι TECH μετρικές είναι περισσότερες, οπότε από την 8η και
 * μετά (HSDPA κ.ε.) τα χρώματα ανακυκλώνονται: σύγκρουση μόνο αν ένα pie δείχνει
 * ταυτόχρονα 5G SA ΚΑΙ 3G — πρακτικά αδύνατο στα δίκτυα που μετράμε.
 */
const SERVING_PIE_COLORS = new Map<number, string>(
  (["BAND", "TECH"] as const).flatMap((kind) =>
    SERVING_BAND_TECH_METRICS
      .filter((metric) => metric.kind === kind && metric.code !== "#NODATA")
      .map((metric, index): [number, string] => [metric.ord, PIE_PALETTE[index % PIE_PALETTE.length]]),
  ),
);

/** Τα (μη-μηδενικά) BAND/TECH slices ενός operator, σταθερό χρώμα ανά τεχνολογία. */
export const buildServingPieSlices = (
  shares: ServingBandTechShare[],
): { bandSlices: PieSlice[]; techSlices: PieSlice[] } => {
  const toSlice = (share: ServingBandTechShare): PieSlice => ({
    name: pieSliceName(share.label),
    value: share.samples,
    pct: share.pct ?? 0,
    color: SERVING_PIE_COLORS.get(share.ord) ?? NO_DATA_COLOR,
  });

  return {
    bandSlices: shares.filter((share) => share.kind === "BAND" && share.samples > 0).map(toSlice),
    techSlices: shares.filter((share) => share.kind === "TECH" && share.samples > 0).map(toSlice),
  };
};
