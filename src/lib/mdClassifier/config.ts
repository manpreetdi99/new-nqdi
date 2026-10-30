/**
 * Παράμετροι του ταξινομητή του volte-drop-fail-analysis.md. Τα όρια και οι user codes
 * είναι ρύθμιση (md §1.5, §1.6: «ενδεικτικά όρια, παραμετρικά»), όχι σκληροκωδικοποιημένα.
 */
export interface MdConfig {
  /** §1.6: radio pattern = RSRP < rsrpLow ή SINR < sinrLow στα τελευταία lastWindowSec. */
  rsrpLow: number;
  sinrLow: number;
  lastWindowSec: number;
  /** §1.5: κωδικοί που σημαίνουν χρήστη / άκυρη δοκιμή και ΔΕΝ μετρούν ως network fail. */
  userCodes: readonly number[];
  /** §1.5: network fail. */
  networkCodes: readonly number[];
}

export const MD_CONFIG: MdConfig = {
  rsrpLow: -115,
  sinrLow: -3,
  lastWindowSec: 5,
  userCodes: [404, 486, 603, 604],
  networkCodes: [408, 480, 500, 503, 504, 580],
};
