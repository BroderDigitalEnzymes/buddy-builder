import { join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { extractSearchableText, type SearchableChunk } from "./search-text-extractor.js";

export type { SearchableChunk } from "./search-text-extractor.js";

export type RawSearchResult = {
  sessionId: string;
  snippet: string;
  contentType: string;
  rank: number;
};

export type IndexStatus = {
  totalSessions: number;
  indexedSessions: number;
  isIndexing: boolean;
};

// ─── Search Index ───────────────────────────────────────────────

export type SearchIndex = {
  search(query: string, limit?: number): RawSearchResult[];
  indexSession(sessionId: string, transcriptPath: string, sessionName?: string): boolean;
  removeSession(sessionId: string): void;
  reindexAll(sessions: { sessionId: string; transcriptPath: string | null; sessionName?: string }[]): void;
  getStatus(): IndexStatus;
  setTotalSessions(n: number): void;
  setIndexing(v: boolean): void;
  close(): void;
};

// ─── Tokenizer (simple porter-like word splitting) ──────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// ─── In-memory search index with JSON persistence ───────────────

type IndexedSession = {
  transcriptPath: string;
  fileSize: number;
  fileMtime: number;
  sessionName: string;
  chunks: { text: string; contentType: string; tokens: string[] }[];
};

type PersistedData = {
  sessions: Record<string, IndexedSession>;
};

export function createSearchIndex(customPath?: string): SearchIndex {
  let indexPath: string;
  if (customPath) {
    indexPath = customPath;
  } else {
    const { app } = require("electron");
    indexPath = join(app.getPath("userData"), "search-index.json");
  }

  // Load persisted index
  const sessions = new Map<string, IndexedSession>();
  try {
    if (existsSync(indexPath)) {
      const raw: PersistedData = JSON.parse(readFileSync(indexPath, "utf-8"));
      for (const [id, data] of Object.entries(raw.sessions)) {
        sessions.set(id, data);
      }
    }
  } catch {
    // Corrupted file — start fresh
  }

  let totalSessions = 0;
  let isIndexing = false;
  let savePending = false;

  function scheduleSave(): void {
    if (savePending) return;
    savePending = true;
    // Debounce writes — save on next tick after a batch of indexing
    setImmediate(() => {
      savePending = false;
      persist();
    });
  }

  function persist(): void {
    try {
      const data: PersistedData = {
        sessions: Object.fromEntries(sessions),
      };
      writeFileSync(indexPath, JSON.stringify(data), "utf-8");
    } catch (err) {
      console.error("[search] Failed to persist index:", err);
    }
  }

  function scoreMatch(tokens: string[], queryTokens: string[]): number {
    let matched = 0;
    for (const qt of queryTokens) {
      for (const t of tokens) {
        if (t === qt) { matched += 2; break; }
        if (t.startsWith(qt)) { matched += 1; break; }
      }
    }
    return matched;
  }

  function buildSnippet(text: string, queryTokens: string[]): string {
    const lower = text.toLowerCase();
    // Find the first matching token position
    let bestPos = 0;
    for (const qt of queryTokens) {
      const idx = lower.indexOf(qt);
      if (idx >= 0) { bestPos = idx; break; }
    }

    // Extract a window around the match
    const start = Math.max(0, bestPos - 40);
    const end = Math.min(text.length, bestPos + 120);
    let snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");

    // Highlight matches with <mark> tags
    for (const qt of queryTokens) {
      const re = new RegExp(`(${qt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*)`, "gi");
      snippet = snippet.replace(re, "<mark>$1</mark>");
    }

    return snippet;
  }

  return {
    search(query: string, limit = 50): RawSearchResult[] {
      const queryTokens = tokenize(query);
      if (queryTokens.length === 0) return [];

      const results: RawSearchResult[] = [];

      for (const [sessionId, session] of sessions) {
        let bestScore = 0;
        let bestSnippet = "";
        let bestContentType = "";

        // Check session name first (title matches rank higher)
        if (session.sessionName && session.sessionName !== "New Session") {
          const nameTokens = tokenize(session.sessionName);
          const nameScore = scoreMatch(nameTokens, queryTokens);
          if (nameScore > 0) {
            bestScore = nameScore * 3; // Boost title matches
            bestSnippet = buildSnippet(session.sessionName, queryTokens);
            bestContentType = "title";
          }
        }

        // Check content chunks
        for (const chunk of session.chunks) {
          const score = scoreMatch(chunk.tokens, queryTokens);
          if (score > bestScore) {
            bestScore = score;
            bestSnippet = buildSnippet(chunk.text, queryTokens);
            bestContentType = chunk.contentType;
          }
        }

        if (bestScore > 0) {
          results.push({
            sessionId,
            snippet: bestSnippet,
            contentType: bestContentType,
            rank: -bestScore, // Negative so lower = better (matching FTS5 convention)
          });
        }
      }

      // Sort by rank (most negative = best match)
      results.sort((a, b) => a.rank - b.rank);
      return results.slice(0, limit);
    },

    indexSession(sessionId: string, transcriptPath: string, sessionName?: string): boolean {
      let stat;
      try {
        const fs = require("fs");
        stat = fs.statSync(transcriptPath);
      } catch {
        return false;
      }

      const nameStr = sessionName ?? "";
      const existing = sessions.get(sessionId);

      if (
        existing &&
        existing.fileSize === stat.size &&
        existing.fileMtime === stat.mtimeMs &&
        existing.sessionName === nameStr
      ) {
        return false; // unchanged
      }

      const rawChunks = extractSearchableText(transcriptPath);
      const chunks = rawChunks.map((c) => ({
        text: c.text,
        contentType: c.contentType,
        tokens: tokenize(c.text),
      }));

      sessions.set(sessionId, {
        transcriptPath,
        fileSize: stat.size,
        fileMtime: stat.mtimeMs,
        sessionName: nameStr,
        chunks,
      });

      scheduleSave();
      return true;
    },

    removeSession(sessionId: string): void {
      if (sessions.delete(sessionId)) {
        scheduleSave();
      }
    },

    reindexAll(sessionList): void {
      totalSessions = sessionList.length;
      for (const s of sessionList) {
        if (s.transcriptPath) {
          this.indexSession(s.sessionId, s.transcriptPath, s.sessionName);
        }
      }
    },

    getStatus(): IndexStatus {
      return {
        totalSessions,
        indexedSessions: sessions.size,
        isIndexing,
      };
    },

    setTotalSessions(n: number): void {
      totalSessions = n;
    },

    setIndexing(v: boolean): void {
      isIndexing = v;
    },

    close(): void {
      persist();
    },
  };
}

// Re-export extractSearchableText for consumers that import from this module
export { extractSearchableText } from "./search-text-extractor.js";
