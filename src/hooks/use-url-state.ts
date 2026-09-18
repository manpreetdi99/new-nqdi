import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State που ζει στο query string του URL, με το localStorage ως fallback.
 *
 * Κανόνας: **το URL κερδίζει**. Στο mount, αν το param υπάρχει στο URL το χρησιμοποιούμε·
 * αλλιώς διαβάζουμε το (παλιό) localStorage key και το γράφουμε μία φορά πίσω στο URL, ώστε
 * το link που κάνει copy ο χρήστης να περιγράφει πλήρως αυτό που βλέπει. Κάθε set γράφει και
 * στα δύο, οπότε η συμπεριφορά "θυμάται την τελευταία επιλογή σε νέο tab" δεν χάνεται.
 *
 * Ίδιο API με το useLocalStorage (τιμή + setter που δέχεται και updater function), ώστε τα
 * call sites να μην αλλάζουν.
 */

/** Subscribers για αλλαγές που κάνουμε εμείς — η history.replaceState ΔΕΝ στέλνει event. */
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

const readRaw = (param: string): string[] => {
  if (typeof window === "undefined") return [];
  return new URLSearchParams(window.location.search).getAll(param);
};

const writeRaw = (param: string, values: string[]) => {
  if (typeof window === "undefined") return;
  // Διαβάζουμε ΠΑΝΤΑ το ζωντανό location.search (όχι snapshot από το render), ώστε δύο setters
  // μέσα στο ίδιο event handler (π.χ. openCallDetail: tab + subtab + call) να μη σβήνει ο ένας
  // τη γραφή του άλλου.
  const params = new URLSearchParams(window.location.search);
  params.delete(param);
  values.forEach((value) => params.append(param, value));
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  // replaceState και όχι pushState: το URL εδώ είναι για share/reload. Με pushState κάθε
  // αλλαγή collection θα γέμιζε το ιστορικό και το "Πίσω" του browser θα χρειαζόταν 20 πατήματα
  // για να βγεις από τη σελίδα — η προηγούμενη συμπεριφορά (localStorage) δεν άγγιζε καθόλου
  // το history.
  window.history.replaceState(window.history.state, "", url);
  notify();
};

const readStorage = (key: string | undefined): unknown => {
  if (!key || typeof window === "undefined") return undefined;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : undefined;
  } catch (error) {
    console.warn(`Error reading localStorage key “${key}”:`, error);
    return undefined;
  }
};

const writeStorage = (key: string | undefined, value: unknown) => {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Error setting localStorage key “${key}”:`, error);
  }
};

const sameRaw = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

export interface UrlStateOptions<T> {
  /** Μετατροπή των τιμών του param (getAll → πολλαπλές τιμές για list state) σε T. */
  parse: (raw: string[]) => T;
  /** Πίσω σε τιμές του param. Κενό array ⇒ το param φεύγει τελείως από το URL. */
  serialize: (value: T) => string[];
  /** Προαιρετικό localStorage key — fallback όταν λείπει το param από το URL. */
  storageKey?: string;
  /** Φύλακας για ό,τι βρεθεί στο localStorage (μπορεί να είναι παλιό/λάθος σχήμα). */
  isValidStored?: (stored: unknown) => stored is T;
}

export function useUrlState<T>(param: string, initialValue: T, options: UrlStateOptions<T>) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const initialRef = useRef(initialValue);

  const [value, setValue] = useState<T>(() => {
    const raw = readRaw(param);
    if (raw.length > 0) return options.parse(raw);
    const stored = readStorage(options.storageKey);
    if (stored !== undefined && (!options.isValidStored || options.isValidStored(stored))) {
      return stored as T;
    }
    return initialValue;
  });

  const valueRef = useRef(value);
  valueRef.current = value;

  // Η αρχική τιμή ήρθε από localStorage/default και λείπει από το URL — γράψ' τη μία φορά,
  // αλλιώς ένα share link θα έδειχνε άλλα δεδομένα σε άλλον browser.
  useEffect(() => {
    if (readRaw(param).length > 0) return;
    const serialized = optionsRef.current.serialize(valueRef.current);
    if (serialized.length > 0) writeRaw(param, serialized);
  }, [param]);

  // Back/forward ή γραφή από άλλο hook πάνω στο ίδιο param.
  useEffect(() => {
    const sync = () => {
      const raw = readRaw(param);
      if (sameRaw(raw, optionsRef.current.serialize(valueRef.current))) return;
      setValue(raw.length > 0 ? optionsRef.current.parse(raw) : initialRef.current);
    };
    listeners.add(sync);
    window.addEventListener("popstate", sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("popstate", sync);
    };
  }, [param]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = next instanceof Function ? next(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      writeStorage(optionsRef.current.storageKey, resolved);
      writeRaw(param, optionsRef.current.serialize(resolved));
    },
    [param]
  );

  return [value, set] as const;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Ένα string στο URL (`?db=Foo`). Κενό string ⇒ το param φεύγει.
 * Με `allowed` αγνοούνται τιμές εκτός λίστας (χειρόγραφο/παλιό URL δεν σπάει το UI).
 */
export function useUrlStringState<T extends string>(
  param: string,
  initialValue: T,
  options: { storageKey?: string; allowed?: readonly T[] } = {}
) {
  const { storageKey, allowed } = options;
  return useUrlState<T>(param, initialValue, {
    parse: (raw) => {
      const first = raw[0] as T | undefined;
      if (first === undefined || first === "") return initialValue;
      if (allowed && !allowed.includes(first)) return initialValue;
      return first;
    },
    serialize: (value) => (value ? [value] : []),
    storageKey,
    isValidStored: (stored): stored is T => isString(stored) && (!allowed || allowed.includes(stored as T)),
  });
}

/** Λίστα σε επαναλαμβανόμενα params (`?collections=a&collections=b`) — ασφαλές για ονόματα με κόμμα. */
export function useUrlStringListState(
  param: string,
  initialValue: string[] = [],
  options: { storageKey?: string } = {}
) {
  return useUrlState<string[]>(param, initialValue, {
    parse: (raw) => raw.filter(Boolean),
    serialize: (value) => value.filter(Boolean),
    storageKey: options.storageKey,
    isValidStored: isStringArray,
  });
}

/** Προαιρετικό id (`?call=123`) — `null` όταν λείπει. Δεν περνάει από localStorage by default. */
export function useUrlNullableStringState(param: string, options: { storageKey?: string } = {}) {
  return useUrlState<string | null>(param, null, {
    parse: (raw) => raw[0] ?? null,
    serialize: (value) => (value ? [value] : []),
    storageKey: options.storageKey,
    isValidStored: (stored): stored is string | null => stored === null || isString(stored),
  });
}
