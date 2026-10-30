/**
 * Περίληψη ανά κλήση: γιατί πιστεύουμε ότι ο χρήστης έγραψε αυτό το σχόλιο
 * (ποια δεδομένα το στηρίζουν), τι το αντικρούει και η ετυμηγορία.
 */
import { LABEL_TITLES, type ParsedComment } from "./labels";
import { BAD_RADIO_FEATURES, type CallEvidence, type EvidenceFact } from "./evidence";
import { profileFor } from "./profiles";
import type { AuditScore } from "./scoring";

export interface Narrative {
  why: string;
  against: string | null;
  alternative: string | null;
  sideNote: string | null;
  verdict: string;
}

const MAX_OTHER_FACTS = 3;
const RADIO_FEATURES: ReadonlySet<string> = new Set(BAD_RADIO_FEATURES);

const joinFacts = (facts: readonly EvidenceFact[]) => facts.map((f) => f.text).join("· ");

function ruleVerdictText(score: AuditScore, rule: string): string {
  const top = `«${LABEL_TITLES[score.topLabel]}»`;
  if (score.verdict === "correct") return `Κανόνας: ${rule}. Το σχόλιο είναι σωστό — βαθμός 100/100.`;
  if (score.verdict === "not_auditable" || score.verdict === "no_comment") return `Κανόνας: ${rule}. Το σχόλιο πρέπει να είναι ${top}.`;
  return `Κανόνας: ${rule}. Το σχόλιο έπρεπε να είναι ${top} — βαθμός 0/100.`;
}

function verdictText(score: AuditScore): string {
  if (score.rule) return ruleVerdictText(score, score.rule);
  const top = `«${LABEL_TITLES[score.topLabel]}»`;
  switch (score.verdict) {
    case "correct":
      return `Τα δεδομένα στηρίζουν το σχόλιο — βαθμός ${score.grade}/100.`;
    case "partial":
      return `Το σχόλιο στηρίζεται εν μέρει — βαθμός ${score.grade}/100· τα δεδομένα δείχνουν πιο έντονα ${top}.`;
    case "wrong":
      return `Τα δεδομένα δεν στηρίζουν το σχόλιο — βαθμός ${score.grade}/100· πιο πιθανό είναι ${top}.`;
    case "insufficient":
      return "Δεν υπάρχουν αρκετά δεδομένα (ράδιο/σηματοδοσία) για να κριθεί το σχόλιο.";
    case "no_comment":
      return `Χωρίς σχόλιο χρήστη· κατά τα δεδομένα: ${top}.`;
    case "not_auditable":
      return `Το σχόλιο δεν αντιστοιχεί σε κατηγορία που ελέγχεται από τα δεδομένα· τα δεδομένα δείχνουν ${top}.`;
  }
}

function sideNote(comment: ParsedComment, evidence: CallEvidence): string | null {
  if (!comment.side || !evidence.worstRadioSide || comment.side === evidence.worstRadioSide) return null;
  const radioLabel = comment.label?.startsWith("LC_") || comment.label?.startsWith("LQ_");
  if (!radioLabel) return null;
  return `Ο χρήστης έγραψε ${comment.side}-SIDE, αλλά τα χειρότερα δείγματα ράδιο είναι στη ${evidence.worstRadioSide} πλευρά.`;
}

export function buildNarrative(comment: ParsedComment | null, evidence: CallEvidence, score: AuditScore): Narrative {
  const profile = comment?.label ? profileFor(comment.label) : {};
  const weight = (f: EvidenceFact) => profile[f.feature] ?? 0;
  const supporting = evidence.facts.filter((f) => weight(f) > 0);
  const contradicting = evidence.facts.filter((f) => weight(f) < 0);
  const other = evidence.facts
    .filter((f) => weight(f) === 0)
    .sort((a, b) => Number(RADIO_FEATURES.has(b.feature)) - Number(RADIO_FEATURES.has(a.feature)))
    .slice(0, MAX_OTHER_FACTS);

  const raw = comment?.raw ?? "—";
  let why: string;
  if (!comment) {
    const shown = evidence.facts.slice(0, MAX_OTHER_FACTS + 1);
    why = shown.length ? `Χωρίς σχόλιο χρήστη. Είδα: ${joinFacts(shown)}.` : "Χωρίς σχόλιο χρήστη και χωρίς ένδειξη ράδιο ή σηματοδοσίας.";
  } else if (supporting.length) {
    why = `Ο χρήστης έγραψε «${raw}» πιθανότατα επειδή είδε: ${joinFacts(supporting)}.`;
  } else if (evidence.facts.length) {
    why = `Ο χρήστης έγραψε «${raw}», αλλά δεν βρήκα κάτι που να το εξηγεί. Είδα: ${joinFacts(other.length ? other : evidence.facts.slice(0, MAX_OTHER_FACTS))}.`;
  } else {
    why = `Ο χρήστης έγραψε «${raw}». Δεν βρήκα ένδειξη ράδιο ή σηματοδοσίας για την κλήση.`;
  }

  return {
    why,
    against: contradicting.length ? `Το αντικρούουν: ${joinFacts(contradicting)}.` : null,
    alternative: alternativeText(score, evidence, contradicting),
    sideNote: comment ? sideNote(comment, evidence) : null,
    verdict: verdictText(score),
  };
}

/** Για "μερικώς"/"λάθος": ευρήματα που μετράνε περισσότερο για την ετικέτα που βγήκε πρώτη. */
function alternativeText(score: AuditScore, evidence: CallEvidence, alreadyShown: readonly EvidenceFact[]): string | null {
  if (score.verdict !== "partial" && score.verdict !== "wrong") return null;
  const top = profileFor(score.topLabel);
  const user = score.userLabel ? profileFor(score.userLabel) : {};
  const facts = evidence.facts.filter((f) => {
    const w = top[f.feature] ?? 0;
    return w > 0 && w > (user[f.feature] ?? 0) && !alreadyShown.includes(f);
  });
  return facts.length ? `Για «${LABEL_TITLES[score.topLabel]}» μιλούν: ${joinFacts(facts)}.` : null;
}

export function narrativeText(n: Narrative): string {
  return [n.why, n.against, n.alternative, n.sideNote, n.verdict].filter(Boolean).join(" ");
}
