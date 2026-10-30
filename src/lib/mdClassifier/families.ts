/**
 * Κοινή «οικογένεια» για να συγκρίνονται τρία διαφορετικά λεξιλόγια:
 * σχόλιο χρήστη (LC/LQ/CORE/FAKE), audit (ετικέτες pptx) και ταξινομητής md (αιτίες/στάδια §1.6).
 */
import type { AuditLabel } from "@/lib/commentAudit/labels";
import type { MdResult } from "./classify";

export type Family = "RADIO" | "CORE" | "FAKE" | "USER" | "—";

export function labelFamily(label: AuditLabel | null | undefined): Family {
  if (!label) return "—";
  if (/^(LC|LQ)_/.test(label)) return "RADIO";
  if (label.startsWith("CORE_")) return "CORE";
  if (label.startsWith("FAKE_")) return "FAKE";
  return "USER";
}

/** §1.3/§1.4 → οικογένεια. Το UNKNOWN_LOG_GAP του md («drop στο τέλος του αρχείου») αντιστοιχεί στο FAKE. */
export function mdFamily(r: MdResult): Family {
  if (r.kind === "out_of_scope") return "—";
  if (r.networkOrUser === "user") return "USER";
  switch (r.category) {
    case "SRVCC_FAIL":
    case "HO_FAIL":
    case "RLF":
    case "RTP_TIMEOUT":
    case "RRC":
    case "PAGING":
    case "FALLBACK":
      return "RADIO";
    case "UNKNOWN_LOG_GAP":
      return "FAKE";
    default:
      return "CORE";
  }
}
