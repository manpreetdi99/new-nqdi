import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUrlNullableStringState, useUrlStringListState, useUrlStringState } from "./use-url-state";

const setUrl = (search: string) => {
  window.history.replaceState(null, "", `/${search}`);
};

const currentParams = () => new URLSearchParams(window.location.search);

describe("useUrlState", () => {
  beforeEach(() => {
    setUrl("");
    window.localStorage.clear();
  });

  it("διαβάζει την αρχική τιμή από το URL", () => {
    setUrl("?db=NQDI_2026");
    const { result } = renderHook(() => useUrlStringState<string>("db", "", { storageKey: "db-key" }));
    expect(result.current[0]).toBe("NQDI_2026");
  });

  it("το URL κερδίζει το localStorage", () => {
    window.localStorage.setItem("db-key", JSON.stringify("FROM_STORAGE"));
    setUrl("?db=FROM_URL");
    const { result } = renderHook(() => useUrlStringState<string>("db", "", { storageKey: "db-key" }));
    expect(result.current[0]).toBe("FROM_URL");
  });

  it("πέφτει στο localStorage όταν λείπει το param και γράφει την τιμή πίσω στο URL", () => {
    window.localStorage.setItem("db-key", JSON.stringify("FROM_STORAGE"));
    const { result } = renderHook(() => useUrlStringState<string>("db", "", { storageKey: "db-key" }));
    expect(result.current[0]).toBe("FROM_STORAGE");
    expect(currentParams().get("db")).toBe("FROM_STORAGE");
  });

  it("γράφει σε URL και localStorage μαζί", () => {
    const { result } = renderHook(() => useUrlStringState<string>("db", "", { storageKey: "db-key" }));
    act(() => result.current[1]("NQDI_2026"));
    expect(currentParams().get("db")).toBe("NQDI_2026");
    expect(window.localStorage.getItem("db-key")).toBe(JSON.stringify("NQDI_2026"));
  });

  it("αγνοεί τιμή εκτός allowed (χειρόγραφο URL)", () => {
    setUrl("?sub=bogus");
    const { result } = renderHook(() =>
      useUrlStringState<"list" | "detail">("sub", "list", { allowed: ["list", "detail"] as const })
    );
    expect(result.current[0]).toBe("list");
  });

  it("αγνοεί localStorage με λάθος σχήμα", () => {
    window.localStorage.setItem("collections-key", JSON.stringify("not-an-array"));
    const { result } = renderHook(() => useUrlStringListState("collections", [], { storageKey: "collections-key" }));
    expect(result.current[0]).toEqual([]);
  });

  it("κρατάει λίστες σε επαναλαμβανόμενα params, ώστε ονόματα με κόμμα να επιβιώνουν", () => {
    const { result } = renderHook(() => useUrlStringListState("collections", []));
    act(() => result.current[1](["Athens, Center", "Patras"]));
    expect(currentParams().getAll("collections")).toEqual(["Athens, Center", "Patras"]);

    const { result: reread } = renderHook(() => useUrlStringListState("collections", []));
    expect(reread.current[0]).toEqual(["Athens, Center", "Patras"]);
  });

  it("δέχεται updater function όπως το useState/useLocalStorage", () => {
    const { result } = renderHook(() => useUrlStringListState("collections", ["a"]));
    act(() => result.current[1]((prev) => [...prev, "b"]));
    expect(result.current[0]).toEqual(["a", "b"]);
    expect(currentParams().getAll("collections")).toEqual(["a", "b"]);
  });

  it("σβήνει το param όταν η τιμή αδειάσει", () => {
    setUrl("?call=42");
    const { result } = renderHook(() => useUrlNullableStringState("call"));
    expect(result.current[0]).toBe("42");
    act(() => result.current[1](null));
    expect(currentParams().has("call")).toBe(false);
  });

  it("δύο setters στο ίδιο event handler δεν σβήνει ο ένας τον άλλο", () => {
    const { result } = renderHook(() => ({
      tab: useUrlStringState<string>("tab", "queries"),
      call: useUrlNullableStringState("call"),
    }));
    act(() => {
      result.current.tab[1]("calls");
      result.current.call[1]("42");
    });
    expect(currentParams().get("tab")).toBe("calls");
    expect(currentParams().get("call")).toBe("42");
  });

  it("ακολουθεί το back/forward του browser", () => {
    const { result } = renderHook(() => useUrlStringState<string>("tab", "queries"));
    act(() => result.current[1]("calls"));
    expect(result.current[0]).toBe("calls");

    act(() => {
      setUrl("?tab=Summary");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("Summary");
  });
});
