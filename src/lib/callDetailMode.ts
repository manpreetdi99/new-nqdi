/**
 * Το callMode με το οποίο το Call Detail αποφασίζει ΤΙ θα φορτώσει (LTE / GSM / NR σκέλη).
 *
 * Πολλές κλήσεις έρχονται από τη βάση με CA.callmode = '-' (ή κενό, που το Index κάνει "N/A").
 * Χωρίς επίλυση έπεφταν στην περίπτωση «VoLTE» και μια '-' κλήση σε GSM δεν ζητούσε ποτέ GSM
 * μετρήσεις. Εδώ επιλύονται από το technology, με τα ίδια substrings που διαβάζει και το
 * classifyCustomCallMode των KPI (attachmentC.ts) — αλλά με το GSM ΠΡΩΤΑ: μια κλήση "GSM/LTE"
 * γίνεται "CS", και το csTouchesLte του Call Detail ζητάει έτσι ΚΑΙ τα δύο σκέλη. (Τα KPI, κατά
 * το A-LEVEL, βάζουν πρώτα το LTE· εκεί μετράει η κατηγορία, εδώ να φορτωθούν σωστά δεδομένα.)
 */

/** callMode που δεν λέει τίποτα: '-' από τη βάση, "N/A" από το Index όταν ήταν κενό, Unknown. */
export const isUnknownCallMode = (callMode: string | null | undefined): boolean => {
  const mode = (callMode ?? "").trim().toUpperCase();
  return mode === "" || mode === "-" || mode === "N/A" || mode.includes("UNKNOWN");
};

/**
 * Γνωστό mode μένει ως έχει. Άγνωστο → "CS" (GSM/UMTS), "VoLTE" (μόνο LTE), ή "UNKNOWN" όταν
 * δεν υπάρχει ένδειξη (5G ή κενό technology) — τότε το Call Detail φορτώνει όλα τα σκέλη.
 */
export const resolveCallDetailMode = (
  callMode: string | null | undefined,
  technology: string | null | undefined,
): string => {
  if (!isUnknownCallMode(callMode)) return (callMode ?? "").trim();
  const tech = (technology ?? "").toLowerCase();
  if (tech.includes("umts") || tech.includes("gsm")) return "CS";
  if (tech.includes("lte")) return "VoLTE";
  return "UNKNOWN";
};
