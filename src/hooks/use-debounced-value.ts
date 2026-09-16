import { useEffect, useState } from "react";

/**
 * Η ίδια τιμή, αλλά μόνο αφού ησυχάσει για `delayMs`.
 *
 * Φτιάχτηκε για την επιλογή collections του Summary tab: κάθε κλικ σε checkbox άλλαζε
 * αμέσως το queryKey και ξεκινούσε 11 νέα βαριά SQL queries, ΧΩΡΙΣ να σταματάει τα
 * προηγούμενα (ο SQL Server συνεχίζει να τα εκτελεί ακόμα κι όταν ο browser έχει φύγει).
 * Διαλέγοντας 20 collections ένα-ένα, ο server έπαιρνε ~220 queries αντί για 11 — από
 * εκεί έρχονταν τα timeouts.
 *
 * Η ταυτότητα της τιμής διατηρείται (δεν αντιγράφεται), οπότε `value !== debounced`
 * είναι έγκυρος έλεγχος "περιμένουμε ακόμα" ακόμα και για arrays/objects.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (Object.is(value, debounced)) return;

    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, debounced, delayMs]);

  return debounced;
}
