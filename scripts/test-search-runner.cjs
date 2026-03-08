"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/test-search.ts
var import_electron = require("electron");
var os2 = __toESM(require("os"), 1);
var path2 = __toESM(require("path"), 1);
var fs = __toESM(require("fs"), 1);

// src/main/search-index.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
var import_path = require("path");
var import_fs = require("fs");
function createSearchIndex(customDbPath) {
  let dbPath;
  if (customDbPath) {
    dbPath = customDbPath;
  } else {
    const { app: app2 } = require("electron");
    dbPath = (0, import_path.join)(app2.getPath("userData"), "search-index.db");
  }
  const db = new import_better_sqlite3.default(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
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
  try {
    db.exec(`CREATE INDEX idx_fts_session ON fts_session_map(session_id);`);
  } catch {
  }
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
  function sanitizeQuery(raw) {
    let q = raw.replace(/[^\w\s]/g, " ").trim();
    if (!q) return "";
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    const terms = words.map(
      (w, i) => i === words.length - 1 ? `"${w}"*` : `"${w}"`
    );
    return terms.join(" ");
  }
  function deleteSessionRows(sessionId) {
    stmtDeleteFts.run(sessionId);
    stmtDeleteMap.run(sessionId);
    stmtDeleteIndex.run(sessionId);
  }
  return {
    search(query, limit = 50) {
      const sanitized = sanitizeQuery(query);
      if (!sanitized) return [];
      try {
        const rows = stmtSearch.all(sanitized, limit * 3);
        const seen = /* @__PURE__ */ new Map();
        for (const row of rows) {
          if (!seen.has(row.session_id)) {
            seen.set(row.session_id, {
              sessionId: row.session_id,
              snippet: row.snippet,
              contentType: row.content_type,
              rank: row.rank
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
    indexSession(sessionId, transcriptPath) {
      let stat;
      try {
        stat = (0, import_fs.statSync)(transcriptPath);
      } catch {
        return false;
      }
      const existing = stmtGetIndex.get(sessionId);
      if (existing && existing.file_size === stat.size && existing.file_mtime === stat.mtimeMs) {
        return false;
      }
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
    removeSession(sessionId) {
      deleteSessionRows(sessionId);
    },
    reindexAll(sessions) {
      totalSessions = sessions.length;
      for (const s of sessions) {
        if (s.transcriptPath) {
          this.indexSession(s.sessionId, s.transcriptPath);
        }
      }
    },
    getStatus() {
      const row = stmtCountIndexed.get();
      return {
        totalSessions,
        indexedSessions: row.cnt,
        isIndexing
      };
    },
    setIndexing(v) {
      isIndexing = v;
    },
    close() {
      try {
        db.close();
      } catch {
      }
    }
  };
}
var MAX_CHUNK_LEN = 2e3;
function truncate(s, max) {
  return s.length > max ? s.slice(0, max) : s;
}
function extractSearchableText(filePath) {
  let raw;
  try {
    raw = (0, import_fs.readFileSync)(filePath, "utf-8");
  } catch {
    return [];
  }
  const chunks = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "queue-operation" || obj.type === "progress" || obj.type === "file-history-snapshot" || obj.type === "system") {
      continue;
    }
    if (obj.type === "user" && obj.message?.role === "user") {
      const content = obj.message.content;
      if (Array.isArray(content) && content.length > 0 && content[0]?.type === "tool_result") {
        continue;
      }
      const text = extractText(content);
      if (text) {
        chunks.push({ contentType: "user", text: truncate(text, MAX_CHUNK_LEN) });
      }
      continue;
    }
    if (obj.type === "assistant" && obj.message?.role === "assistant") {
      const content = obj.message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "text" && block.text) {
          chunks.push({
            contentType: "assistant",
            text: truncate(block.text, MAX_CHUNK_LEN)
          });
        } else if (block.type === "tool_use") {
          if (block.name) {
            chunks.push({ contentType: "tool_name", text: block.name });
          }
          if (block.input) {
            const inputStr = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
            chunks.push({
              contentType: "tool_input",
              text: truncate(inputStr, MAX_CHUNK_LEN)
            });
          }
        }
      }
      continue;
    }
    if (obj.type === "result" && obj.result) {
      const text = typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result);
      if (text) {
        chunks.push({
          contentType: "tool_result",
          text: truncate(text, MAX_CHUNK_LEN)
        });
      }
    }
  }
  return chunks;
}
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n");
  }
  return "";
}

// src/main/transcript.ts
var os = __toESM(require("os"), 1);
var path = __toESM(require("path"), 1);
var import_fs2 = require("fs");
function claudeProjectsRoot() {
  return path.join(os.homedir(), ".claude", "projects");
}
function decodeProjectName(encoded) {
  return "/" + encoded.replace(/^-/, "").replace(/-/g, "/");
}
function discoverAllSessions() {
  const root = claudeProjectsRoot();
  let dirs;
  try {
    dirs = (0, import_fs2.readdirSync)(root);
  } catch {
    return [];
  }
  const allStubs = [];
  for (const dir of dirs) {
    const fullPath = path.join(root, dir);
    try {
      if (!(0, import_fs2.statSync)(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const projectName = decodeProjectName(dir);
    allStubs.push(...discoverSessions(fullPath, projectName));
  }
  return allStubs.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
function discoverSessions(projectDir, projectName) {
  let files;
  try {
    files = (0, import_fs2.readdirSync)(projectDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const stubs = [];
  for (const file of files) {
    const filePath = path.join(projectDir, file);
    try {
      if ((0, import_fs2.statSync)(filePath).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const stub = extractStub(filePath, projectName ?? path.basename(projectDir));
      if (stub) stubs.push(stub);
    } catch {
    }
  }
  return stubs.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
function extractStub(filePath, projectName) {
  const raw = (0, import_fs2.readFileSync)(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  let sessionId = null;
  let cwd = null;
  let firstPrompt = "";
  let slug = "";
  let createdAt = 0;
  let lastActiveAt = 0;
  const headLines = lines.slice(0, 30);
  for (const line of headLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.sessionId && !sessionId) sessionId = obj.sessionId;
      if (obj.cwd && !cwd) cwd = obj.cwd;
      if (obj.slug && !slug) slug = obj.slug;
      if (obj.timestamp && !createdAt) createdAt = new Date(obj.timestamp).getTime();
      if (!firstPrompt && obj.type === "user" && obj.message?.content) {
        const text = extractUserText(obj.message.content);
        if (text) firstPrompt = text.slice(0, 120);
      }
    } catch {
    }
  }
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    if (last.timestamp) lastActiveAt = new Date(last.timestamp).getTime();
  } catch {
  }
  if (!sessionId) return null;
  return {
    claudeSessionId: sessionId,
    transcriptPath: filePath,
    projectName,
    cwd,
    firstPrompt: firstPrompt || "(empty session)",
    slug,
    createdAt: createdAt || Date.now(),
    lastActiveAt: lastActiveAt || createdAt || Date.now()
  };
}
function extractUserText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n");
  }
  return "";
}

// src/main/search-worker.ts
function startBackgroundIndex(index, sessions, onProgress) {
  const CHUNK_SIZE = 5;
  let cancelled = false;
  let i = 0;
  index.setIndexing(true);
  function processChunk() {
    if (cancelled) {
      index.setIndexing(false);
      return;
    }
    const end = Math.min(i + CHUNK_SIZE, sessions.length);
    for (; i < end; i++) {
      const s = sessions[i];
      if (s.transcriptPath) {
        try {
          index.indexSession(s.sessionId, s.transcriptPath);
        } catch (err) {
          console.error(`[search-worker] Failed to index ${s.sessionId}:`, err);
        }
      }
    }
    onProgress(index.getStatus());
    if (i < sessions.length) {
      setImmediate(processChunk);
    } else {
      index.setIndexing(false);
      onProgress(index.getStatus());
    }
  }
  setImmediate(processChunk);
  return {
    cancel() {
      cancelled = true;
    }
  };
}

// scripts/test-search.ts
var green = (s) => `\x1B[32m${s}\x1B[0m`;
var red = (s) => `\x1B[31m${s}\x1B[0m`;
var cyan = (s) => `\x1B[36m${s}\x1B[0m`;
var dim = (s) => `\x1B[2m${s}\x1B[0m`;
var passed = 0;
var failed = 0;
function assert(condition, label) {
  if (condition) {
    console.log(green("  PASS") + ` ${label}`);
    passed++;
  } else {
    console.log(red("  FAIL") + ` ${label}`);
    failed++;
  }
}
async function runTests() {
  console.log(cyan("\n=== Test 1: extractSearchableText ===\n"));
  const stubs = discoverAllSessions();
  console.log(dim(`  Discovered ${stubs.length} sessions`));
  assert(stubs.length > 0, "Found at least one session transcript");
  if (stubs.length > 0) {
    const first = stubs[0];
    console.log(dim(`  Parsing: ${first.transcriptPath}`));
    const chunks = extractSearchableText(first.transcriptPath);
    console.log(dim(`  Extracted ${chunks.length} chunks`));
    assert(chunks.length > 0, "Extracted at least one chunk");
    const types = new Set(chunks.map((c) => c.contentType));
    console.log(dim(`  Content types: ${[...types].join(", ")}`));
    assert(types.has("user") || types.has("assistant"), "Has user or assistant content");
    const empties = chunks.filter((c) => !c.text.trim());
    assert(empties.length === 0, "No empty text chunks");
    const longOnes = chunks.filter((c) => c.text.length > 2e3);
    assert(longOnes.length === 0, "All chunks truncated to <= 2000 chars");
  }
  console.log(cyan("\n=== Test 2: createSearchIndex + indexing ===\n"));
  const tmpDir = fs.mkdtempSync(path2.join(os2.tmpdir(), "buddy-search-test-"));
  const testDbPath = path2.join(tmpDir, "test-search.db");
  console.log(dim(`  DB path: ${testDbPath}`));
  const index = createSearchIndex(testDbPath);
  const toIndex = stubs.slice(0, Math.min(10, stubs.length));
  console.log(dim(`  Indexing ${toIndex.length} sessions...`));
  const t0 = Date.now();
  const uniqueIds = new Set(toIndex.map((s) => s.claudeSessionId));
  for (const stub of toIndex) {
    index.indexSession(stub.claudeSessionId, stub.transcriptPath);
  }
  const elapsed = Date.now() - t0;
  console.log(dim(`  Indexed in ${elapsed}ms (${toIndex.length} stubs, ${uniqueIds.size} unique IDs)`));
  const status = index.getStatus();
  const indexedCount = status.indexedSessions;
  console.log(dim(`  Status: ${JSON.stringify(status)}`));
  assert(indexedCount > 0, `Indexed ${indexedCount} sessions`);
  assert(indexedCount <= uniqueIds.size, `Indexed count (${indexedCount}) <= unique IDs (${uniqueIds.size})`);
  console.log(cyan("\n=== Test 3: search ===\n"));
  const queries = ["function", "error", "file", "test"];
  let anyResults = false;
  for (const q of queries) {
    const results = index.search(q, 5);
    console.log(dim(`  "${q}" \u2192 ${results.length} results`));
    if (results.length > 0) {
      anyResults = true;
      const first = results[0];
      console.log(dim(`    Best: session=${first.sessionId.slice(0, 8)} rank=${first.rank.toFixed(4)} type=${first.contentType}`));
      console.log(dim(`    Snippet: ${first.snippet.replace(/<\/?mark>/g, "**").slice(0, 120)}`));
      assert(first.snippet.includes("<mark>"), `Snippet has <mark> tags for "${q}"`);
      assert(first.sessionId.length > 0, `Result has sessionId for "${q}"`);
    }
  }
  assert(anyResults, "At least one query returned results");
  const emptyResults = index.search("", 10);
  assert(emptyResults.length === 0, "Empty query returns no results");
  const nonsenseResults = index.search("xyzzy_qqq_nope_12345", 10);
  assert(nonsenseResults.length === 0, "Nonsense query returns no results");
  const prefixResults = index.search("func", 5);
  console.log(dim(`  "func" (prefix) \u2192 ${prefixResults.length} results`));
  console.log(cyan("\n=== Test 4: change detection ===\n"));
  if (toIndex.length > 0) {
    const t1 = Date.now();
    index.indexSession(toIndex[0].claudeSessionId, toIndex[0].transcriptPath);
    const skipTime = Date.now() - t1;
    console.log(dim(`  Re-index (unchanged) took ${skipTime}ms`));
    assert(skipTime < 50, "Unchanged session re-index is fast (<50ms)");
    const statusAfter = index.getStatus();
    assert(
      statusAfter.indexedSessions === indexedCount,
      `Count unchanged after re-index (${statusAfter.indexedSessions})`
    );
  }
  console.log(cyan("\n=== Test 5: removeSession ===\n"));
  if (toIndex.length > 0) {
    const indexedStub = toIndex.find((s) => {
      const row = index.search(s.claudeSessionId.slice(0, 8), 1);
      return true;
    });
    const removeId = indexedStub.claudeSessionId;
    const countBefore = index.getStatus().indexedSessions;
    index.removeSession(removeId);
    const statusAfterRemove = index.getStatus();
    console.log(dim(`  Before: ${countBefore}, After: ${statusAfterRemove.indexedSessions}`));
    assert(
      statusAfterRemove.indexedSessions === countBefore - 1,
      "Count decremented after remove"
    );
    index.indexSession(indexedStub.claudeSessionId, indexedStub.transcriptPath);
  }
  console.log(cyan("\n=== Test 6: background indexing (startBackgroundIndex) ===\n"));
  const tmpDb2 = path2.join(tmpDir, "test-bg.db");
  const bgIndex = createSearchIndex(tmpDb2);
  const bgSessions = toIndex.map((s) => ({
    sessionId: s.claudeSessionId,
    transcriptPath: s.transcriptPath
  }));
  let progressCalls = 0;
  let finalStatus = null;
  await new Promise((resolve) => {
    startBackgroundIndex(bgIndex, bgSessions, (st) => {
      progressCalls++;
      finalStatus = st;
      if (!st.isIndexing) {
        resolve();
      }
    });
  });
  console.log(dim(`  Progress callbacks: ${progressCalls}`));
  console.log(dim(`  Final status: ${JSON.stringify(finalStatus)}`));
  assert(progressCalls > 0, "onProgress called at least once");
  assert(finalStatus && !finalStatus.isIndexing, "Indexing completed (isIndexing=false)");
  assert(
    finalStatus && finalStatus.indexedSessions > 0,
    `Background worker indexed ${finalStatus?.indexedSessions} sessions`
  );
  bgIndex.close();
  console.log(cyan("\n=== Test 7: query edge cases ===\n"));
  const edgeCases = [
    'hello"world',
    "OR AND NOT",
    "***",
    "(foo) NEAR bar",
    "test-case",
    "foo:bar",
    "   spaces   "
  ];
  for (const q of edgeCases) {
    try {
      const results = index.search(q, 5);
      console.log(dim(`  "${q}" \u2192 ${results.length} results (no crash)`));
    } catch (err) {
      console.log(red(`  "${q}" \u2192 CRASHED: ${err}`));
      failed++;
      continue;
    }
    passed++;
  }
  index.close();
  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch {
  }
  console.log(cyan("\n=== Summary ===\n"));
  console.log(`  ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : dim("0 failed")}`);
  console.log();
}
import_electron.app.disableHardwareAcceleration();
import_electron.app.whenReady().then(async () => {
  try {
    await runTests();
  } catch (err) {
    console.error(red("FATAL:"), err);
    failed++;
  }
  import_electron.app.exit(failed > 0 ? 1 : 0);
});
