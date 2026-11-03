/**
 * URL που ανοίγει μια κλήση στο Call Detail (tab "calls", sub "detail"). Το Call Detail βρίσκει
 * την κλήση μέσα στη λίστα της βάσης/των collections, γι' αυτό μπαίνουν και αυτά στο URL
 * (ίδια ονόματα params με το useUrlState του Index: db, collections, tab, sub, call).
 */
export function callDetailUrl(database: string, sessionId: string | number, collection?: string | null, basePath = "/"): string {
  const params = new URLSearchParams({ db: database, tab: "calls", sub: "detail", call: String(sessionId) });
  if (collection) params.append("collections", collection);
  return `${basePath}?${params.toString()}`;
}
