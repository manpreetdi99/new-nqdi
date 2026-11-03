/** Μετά από τόσο χρόνο χωρίς δραστηριότητα ο χρήστης αποσυνδέεται (ίδιο όριο με το backend: auth.IDLE_TIMEOUT_SECONDS). */
export const IDLE_LIMIT_MS = 30 * 60_000;

/** Κάθε πότε στέλνουμε heartbeat στο backend όσο ο χρήστης είναι ενεργός (πολύ μικρότερο από το idle όριο). */
export const PING_INTERVAL_MS = 5 * 60_000;

/** Κάθε πότε ελέγχουμε το idle (σε ms)· οι timers παγώνουν σε sleep, γι' αυτό συγκρίνουμε πάντα με Date.now(). */
export const IDLE_CHECK_INTERVAL_MS = 15_000;

export const isIdle = (lastActivityAt: number, now: number, limitMs: number = IDLE_LIMIT_MS): boolean =>
  now - lastActivityAt >= limitMs;

/** Heartbeat μόνο αν υπήρξε δραστηριότητα από το προηγούμενο ping ΚΑΙ πέρασε το διάστημα — ο idle χρήστης δεν κρατά ζωντανό το session. */
export const shouldPing = (
  lastActivityAt: number,
  lastPingAt: number,
  now: number,
  intervalMs: number = PING_INTERVAL_MS,
): boolean => lastActivityAt > lastPingAt && now - lastPingAt >= intervalMs;
