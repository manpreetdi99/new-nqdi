import "@testing-library/jest-dom";

// Node 25 εκθέτει δικό του experimental `localStorage` global που, χωρίς --localstorage-file,
// φτάνει εδώ σαν άδειο αντικείμενο ΧΩΡΙΣ getItem/setItem/clear και σκιάζει το localStorage
// του jsdom. Ό,τι χρησιμοποιεί useLocalStorage (Summary compact toggle, database/collections
// επιλογές) θα έπεφτε σιωπηλά στο initialValue. Ένα in-memory Storage το επαναφέρει.
const memoryStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  } as Storage;
};

for (const key of ["localStorage", "sessionStorage"] as const) {
  if (typeof window[key]?.getItem !== "function") {
    Object.defineProperty(window, key, { writable: true, configurable: true, value: memoryStorage() });
  }
}

// recharts' ResponsiveContainer (VoiceRateBarChart/MiniPie/ServingBandTechPies στο
// SummaryTab, compact είναι πλέον το default — βλ. 2026-08-31) χρειάζεται ResizeObserver
// για να μετρήσει το container του· jsdom δεν το υλοποιεί καθόλου, οπότε χωρίς αυτό κάθε
// render με ένα recharts chart πετάει "ResizeObserver is not defined". No-op stub αρκεί —
// τα tests δεν εξαρτώνται από πραγματικές διαστάσεις.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window.ResizeObserver === "undefined") {
  Object.defineProperty(window, "ResizeObserver", { writable: true, configurable: true, value: ResizeObserverStub });
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
