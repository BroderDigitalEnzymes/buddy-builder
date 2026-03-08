import Database from "better-sqlite3";
import { join } from "path";
import { readFileSync, statSync } from "fs";

// ─── Types ──────────────────────────────────────────────────────

export type SearchableChunk = {
  contentType: "user" | "assistant" | "tool_name" | "tool_input" | "tool_result";
  text: string;
};

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
  indexSession(sessionId: string, transcriptPath: string): boolean;
  removeSession(sessionId: string): void;
  reindexAll(sessions: { sessionId: string; transcriptPath: string | null }[]): void;
  getStatus(): IndexStatus;
  setIndexing(v: boolean): void;
  close(): void;
};

export function createSearchIndex(customDbPath?: string): SearchIndex {
  let dbPath: string;
  if (customDbPath) {
    dbPath = customDbPath;
  } else {
    // Electron runtime — import app lazily
    const { app } = require("electron");
    dbPath = join(app.getPath("userData"), "search-index.db");
  }
  const db = new Database(dbPath);

  // Performance settings
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_index (
      session_id      TEXT PRIMARY KEY,
      transcript_path TEXT NOT NULL,
      file_size       INTEGER NOT NULL,
      file_mtime      REAL NOT NULL,
      indexed_at      INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      session_id UNINDEXED,
      content,
      content_type,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS fts_session_map (
      rowid       INTEGER PRIMARY KEY,
      session_id  TEXT NOT NULL
    );
  `);

  // Create index if not exists
  try {
    db.exec(`CREATE INDEX idx_fts_session ON fts_session_map(session_id);`);
  } catch {
    // Index already exists
  }

  // Prepared statements
  const stmtGetIndex = db.prepare(
    `SELECT file_size, file_mtime FROM session_index WHERE session_id = ?`
  );

  const stmtUpsertIndex = db.prepare(
    `INSERT OR REPLACE INTO session_index (session_id, transcript_path, file_size, file_mtime, indexed_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const stmtDeleteIndex = db.prepare(
    `DELETE FROM session_index WHERE session_id = ?`
  );

  const stmtDeleteFts = db.prepare(
    `DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM fts_session_map WHERE session_id = ?)`
  );

  const stmtDeleteMap = db.prepare(
    `DELETE FROM fts_session_map WHERE session_id = ?`
  );

  const stmtInsertFts = db.prepare(
    `INSERT INTO search_fts (session_id, content, content_type) VALUES (?, ?, ?)`
  );

  const stmtInsertMap = db.prepare(
    `INSERT INTO fts_session_map (rowid, session_id) VALUES (?, ?)`
  );

  const stmtSearch = db.prepare(`
    SELECT
      session_id,
      snippet(search_fts, 1, '<mark>', '</mark>', '...', 40) AS snippet,
      content_type,
      rank
    FROM search_fts
    WHERE search_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  const stmtCountIndexed = db.prepare(
    `SELECT COUNT(*) as cnt FROM session_index`
  );

  let totalSessions = 0;
  let isIndexing = false;

  function sanitizeQuery(raw: string): string {
    // Remove FTS5 metacharacters, keep words
    let q = raw.replace(/[^\w\s]/g, " ").trim();
    if (!q) return "";

    // Split into words, add prefix matching for the last word (search-as-you-type)
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";

    // Quote each word to escape any FTS5 keywords, add * to last word for prefix
    const terms = words.map((w, i) =>
      i === words.length - 1 ? `"${w}"*` : `"${w}"`
    );
    return terms.join(" ");
  }

  function deleteSessionRows(sessionId: string): void {
    stmtDeleteFts.run(sessionId);
    stmtDeleteMap.run(sessionId);
    stmtDeleteIndex.run(sessionId);
  }

  return {
    search(query: string, limit = 50): RawSearchResult[] {
      const sanitized = sanitizeQuery(query);
      if (!sanitized) return [];

      try {
        const rows = stmtSearch.all(sanitized, limit * 3) as {
          session_id: string;
          snippet: string;
          content_type: string;
          rank: number;
        }[];

        // Dedup by session — keep best rank per session
        const seen = new Map<string, RawSearchResult>();
        for (const row of rows) {
          if (!seen.has(row.session_id)) {
            seen.set(row.session_id, {
              sessionId: row.session_id,
              snippet: row.snippet,
              contentType: row.content_type,
              rank: row.rank,
            });
            if (seen.size >= limit) break;
          }
        }

        return [...seen.values()];
      } catch (err) {
        console.error("[search] query failed:", err);
        return [];
      }
    },

    indexSession(sessionId: string, transcriptPath: string): boolean {
      // Change detection via file size + mtime
      let stat;
      try {
        stat = statSync(transcriptPath);
      } catch {
        return false; // file gone
      }

      const existing = stmtGetIndex.get(sessionId) as
        | { file_size: number; file_mtime: number }
        | undefined;

      if (
        existing &&
        existing.file_size === stat.size &&
        existing.file_mtime === stat.mtimeMs
      ) {
        return false; // unchanged
      }

      // Delete old rows and re-index
      const chunks = extractSearchableText(transcriptPath);
      const insertAll = db.transaction(() => {
        deleteSessionRows(sessionId);
        for (const chunk of chunks) {
          const info = stmtInsertFts.run(sessionId, chunk.text, chunk.contentType);
          stmtInsertMap.run(info.lastInsertRowid, sessionId);
        }
        stmtUpsertIndex.run(
          sessionId,
          transcriptPath,
          stat.size,
          stat.mtimeMs,
          Date.now()
        );
      });
      insertAll();
      return true;
    },

    removeSession(sessionId: string): void {
      deleteSessionRows(sessionId);
    },

    reindexAll(sessions): void {
      totalSessions = sessions.length;
      for (const s of sessions) {
        if (s.transcriptPath) {
          this.indexSession(s.sessionId, s.transcriptPath);
        }
      }
    },

    getStatus(): IndexStatus {
      const row = stmtCountIndexed.get() as { cnt: number };
      return {
        totalSessions,
        indexedSessions: row.cnt,
        isIndexing,
      };
    },

    setIndexing(v: boolean): void {
      isIndexing = v;
    },

    close(): void {
      try {
        db.close();
      } catch {
        // ignore
      }
    },
  };
}

// ─── Lightweight JSONL text extractor ───────────────────────────

const MAX_CHUNK_LEN = 2000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function extractSearchableText(filePath: string): SearchableChunk[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const chunks: SearchableChunk[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip non-message types
    if (
      obj.type === "queue-operation" ||
      obj.type === "progress" ||
      obj.type === "file-history-snapshot" ||
      obj.type === "system"
    ) {
      continue;
    }

    // User messages
    if (obj.type === "user" && obj.message?.role === "user") {
      const content = obj.message.content;
      // Skip tool_result messages
      if (
        Array.isArray(content) &&
        content.length > 0 &&
        content[0]?.type === "tool_result"
      ) {
        continue;
      }
      const text = extractText(content);
      if (text) {
        chunks.push({ contentType: "user", text: truncate(text, MAX_CHUNK_LEN) });
      }
      continue;
    }

    // Assistant messages
    if (obj.type === "assistant" && obj.message?.role === "assistant") {
      const content = obj.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === "text" && block.text) {
          chunks.push({
            contentType: "assistant",
            text: truncate(block.text, MAX_CHUNK_LEN),
          });
        } else if (block.type === "tool_use") {
          if (block.name) {
            chunks.push({ contentType: "tool_name", text: block.name });
          }
          if (block.input) {
            const inputStr =
              typeof block.input === "string"
                ? block.input
                : JSON.stringify(block.input);
            chunks.push({
              contentType: "tool_input",
              text: truncate(inputStr, MAX_CHUNK_LEN),
            });
          }
        }
      }
      continue;
    }

    // Tool results in "result" type messages
    if (obj.type === "result" && obj.result) {
      const text =
        typeof obj.result === "string"
          ? obj.result
          : JSON.stringify(obj.result);
      if (text) {
        chunks.push({
          contentType: "tool_result",
          text: truncate(text, MAX_CHUNK_LEN),
        });
      }
    }
  }

  return chunks;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n");
  }
  return "";
}
