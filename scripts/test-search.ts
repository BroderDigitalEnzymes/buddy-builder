/**
 * CLI test for the search index backend.
 * Runs inside Electron so native modules (better-sqlite3) load correctly.
 *
 * Usage:
 *   npm run build && npx electron scripts/test-search-runner.cjs
 *
 * Or build + run in one shot:
 *   npx esbuild scripts/test-search.ts --bundle --platform=node --format=cjs --outfile=scripts/test-search-runner.cjs --external:electron --external:better-sqlite3 && npx electron scripts/test-search-runner.cjs
 */

import { app } from "electron";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { extractSearchableText } from "../src/main/search-text-extractor.js";
import { createSearchIndex } from "../src/main/search-index.js";
import { discoverAllSessions } from "../src/main/transcript.js";
import { startBackgroundIndex } from "../src/main/search-worker.js";

// ─── Colors ──────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(green("  PASS") + ` ${label}`);
    passed++;
  } else {
    console.log(red("  FAIL") + ` ${label}`);
    failed++;
  }
}

async function runTests(): Promise<void> {
  // ─── Test 1: extractSearchableText ──────────────────────────────

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

    const longOnes = chunks.filter((c) => c.text.length > 2000);
    assert(longOnes.length === 0, "All chunks truncated to <= 2000 chars");
  }

  // ─── Test 2: createSearchIndex + indexing ───────────────────────

  console.log(cyan("\n=== Test 2: createSearchIndex + indexing ===\n"));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-search-test-"));
  const testDbPath = path.join(tmpDir, "test-search.db");
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

  // ─── Test 3: search ─────────────────────────────────────────────

  console.log(cyan("\n=== Test 3: search ===\n"));

  const queries = ["function", "error", "file", "test"];
  let anyResults = false;

  for (const q of queries) {
    const results = index.search(q, 5);
    console.log(dim(`  "${q}" → ${results.length} results`));
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
  console.log(dim(`  "func" (prefix) → ${prefixResults.length} results`));

  // ─── Test 4: change detection (re-index skip) ──────────────────

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

  // ─── Test 5: removeSession ──────────────────────────────────────

  console.log(cyan("\n=== Test 5: removeSession ===\n"));

  if (toIndex.length > 0) {
    // Find a session that was actually indexed
    const indexedStub = toIndex.find((s) => {
      const row = index.search(s.claudeSessionId.slice(0, 8), 1);
      return true; // just try removing the first one — it has a session_index row
    })!;
    const removeId = indexedStub.claudeSessionId;
    const countBefore = index.getStatus().indexedSessions;
    index.removeSession(removeId);
    const statusAfterRemove = index.getStatus();
    console.log(dim(`  Before: ${countBefore}, After: ${statusAfterRemove.indexedSessions}`));
    assert(
      statusAfterRemove.indexedSessions === countBefore - 1,
      "Count decremented after remove"
    );

    // Re-add it back
    index.indexSession(indexedStub.claudeSessionId, indexedStub.transcriptPath);
  }

  // ─── Test 6: background indexing ────────────────────────────────

  console.log(cyan("\n=== Test 6: background indexing (startBackgroundIndex) ===\n"));

  const tmpDb2 = path.join(tmpDir, "test-bg.db");
  const bgIndex = createSearchIndex(tmpDb2);

  const bgSessions = toIndex.map((s) => ({
    sessionId: s.claudeSessionId,
    transcriptPath: s.transcriptPath as string | null,
  }));

  let progressCalls = 0;
  let finalStatus: any = null;

  await new Promise<void>((resolve) => {
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

  // ─── Test 7: query sanitization edge cases ──────────────────────

  console.log(cyan("\n=== Test 7: query edge cases ===\n"));

  const edgeCases = [
    'hello"world',
    "OR AND NOT",
    "***",
    "(foo) NEAR bar",
    "test-case",
    "foo:bar",
    "   spaces   ",
  ];

  for (const q of edgeCases) {
    try {
      const results = index.search(q, 5);
      console.log(dim(`  "${q}" → ${results.length} results (no crash)`));
    } catch (err) {
      console.log(red(`  "${q}" → CRASHED: ${err}`));
      failed++;
      continue;
    }
    passed++;
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  index.close();

  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch { /* ignore */ }

  // ─── Summary ────────────────────────────────────────────────────

  console.log(cyan("\n=== Summary ===\n"));
  console.log(`  ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : dim("0 failed")}`);
  console.log();
}

// Run headless — no window needed
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    await runTests();
  } catch (err) {
    console.error(red("FATAL:"), err);
    failed++;
  }
  app.exit(failed > 0 ? 1 : 0);
});
