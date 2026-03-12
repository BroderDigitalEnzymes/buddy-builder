import type { SessionData } from "./store.js";

/** Sanitize a user-provided name into a safe folder name. */
export function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Fuzzy-match a query against a target string (subsequence match). */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Check if a session matches a search query (name, cwd, or projectName). */
export function sessionMatchesQuery(s: SessionData, query: string): boolean {
  return fuzzyMatch(query, s.name) || fuzzyMatch(query, s.cwd ?? "") || fuzzyMatch(query, s.projectName);
}

export type SplitResult = {
  live: SessionData[];
  pinned: SessionData[];
  history: SessionData[];
  historyAll: SessionData[];
};

/**
 * Split sessions into live, pinned, capped history, and full history lists.
 * Pure filtering/sorting — no React, no store.
 */
export function splitSessions(
  sessions: SessionData[],
  query: string,
  pinnedIds: Set<string>,
  limit: number,
  contentMatchIds?: Set<string>,
): SplitResult {
  const q = query.trim();

  const matches = (s: SessionData) =>
    sessionMatchesQuery(s, q) || (contentMatchIds?.has(s.id) ?? false);

  const live = sessions.filter((s) => s.state !== "dead");
  const filteredLive = q ? live.filter(matches) : live;

  // Pinned: favorites that are dead
  let pinned = sessions.filter((s) => s.favorite && s.state === "dead");
  if (q) pinned = pinned.filter(matches);
  pinned.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  const pinnedIdSet = new Set(pinned.map((s) => s.id));

  // History: dead, non-pinned, capped
  let dead = sessions.filter((s) => s.state === "dead" && !pinnedIdSet.has(s.id));
  if (q) dead = dead.filter(matches);
  dead.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  // Full history for tree view (all dead, including pinned)
  let allDead = sessions.filter((s) => s.state === "dead");
  if (q) allDead = allDead.filter(matches);

  return {
    live: filteredLive,
    pinned,
    history: dead.slice(0, limit),
    historyAll: allDead,
  };
}
