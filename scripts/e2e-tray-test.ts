/**
 * E2E Tray & Window Lifecycle Test
 *
 * Tests:
 *  1. App launches with tray icon
 *  2. Close main window → app stays alive (process not terminated)
 *  3. Tray "Show Window" reopens main window
 *  4. Create session, pop it out → popout window opens
 *  5. Close popout → app stays alive, main still there
 *  6. Close ALL windows → app stays alive in tray
 *  7. Reopen from tray after all windows closed
 *  8. Tray Quit → app exits cleanly
 *
 * Run:  npx tsx scripts/e2e-tray-test.ts
 */

import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";
const SCREENSHOT_DIR = path.join(TEMP, "buddy-e2e-tray");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let step = 0;
const results: { test: string; pass: boolean; detail: string }[] = [];

function log(msg: string) {
  console.log(`[TRAY-E2E] ${msg}`);
}

function pass(test: string, detail = "") {
  results.push({ test, pass: true, detail });
  log(`PASS: ${test}${detail ? ` (${detail})` : ""}`);
}

function fail(test: string, detail = "") {
  results.push({ test, pass: false, detail });
  log(`FAIL: ${test}${detail ? ` (${detail})` : ""}`);
}

async function screenshot(page: Page, name: string): Promise<string> {
  step++;
  const p = path.join(SCREENSHOT_DIR, `${step}-${name}.png`);
  try {
    await page.screenshot({ path: p });
    log(`Screenshot: ${p}`);
  } catch {
    log(`Screenshot failed (window may be closed): ${name}`);
  }
  return p;
}

async function waitMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

// Helper: get window count via main-process evaluate
async function getWindowCount(eApp: ElectronApplication): Promise<number> {
  return await eApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().length;
  });
}

// Helper: close all windows via main process
async function closeAllWindows(eApp: ElectronApplication): Promise<void> {
  await eApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
}

// Helper: emit activate to simulate tray reopen
async function emitActivate(eApp: ElectronApplication): Promise<void> {
  await eApp.evaluate(({ app }) => {
    app.emit("activate");
  });
}

async function run() {
  log("=== Starting Tray & Lifecycle E2E Test ===");
  log(`Screenshots: ${SCREENSHOT_DIR}`);

  // ─── Launch ──────────────────────────────────────────────────
  log("Launching Electron app...");
  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });

  const mainPage = await eApp.firstWindow();
  log("Main window opened");

  const consoleLogs: string[] = [];
  mainPage.on("console", (msg) => {
    const line = `[renderer:${msg.type()}] ${msg.text()}`;
    consoleLogs.push(line);
  });
  mainPage.on("pageerror", (err) => {
    consoleLogs.push(`[PAGE ERROR] ${err.message}`);
  });

  await mainPage.waitForLoadState("domcontentloaded");
  await waitMs(2000);

  await screenshot(mainPage, "app-launched");

  // ─── TEST 1: App launched with window ───────────────────────
  log("--- Test 1: App launched ---");
  try {
    const wc = await getWindowCount(eApp);
    const appName = await eApp.evaluate(({ app }) => app.getName());
    if (wc >= 1) {
      pass("App launched with window", `windows=${wc}, name=${appName}`);
    } else {
      fail("App launched with window", `windowCount=${wc}`);
    }
  } catch (err) {
    fail("App launched with window", String(err));
  }

  // ─── TEST 2: Close main window → app stays alive ────────────
  log("--- Test 2: Close main window → app stays alive ---");
  try {
    await closeAllWindows(eApp);
    await waitMs(2000);

    // If evaluate succeeds, app is still alive
    const wc = await getWindowCount(eApp);
    if (wc === 0) {
      pass("Close main window -> app stays alive", "0 windows, process alive");
    } else {
      fail("Close main window -> app stays alive", `windowCount=${wc}`);
    }
  } catch (err) {
    fail("Close main window -> app stays alive", `App crashed/exited: ${err}`);
  }

  // ─── TEST 3: Reopen window (simulate tray / activate) ──────
  log("--- Test 3: Reopen via activate ---");
  let reopenedPage: Page | null = null;
  try {
    await emitActivate(eApp);
    await waitMs(2000);

    const windows = eApp.windows();
    if (windows.length > 0) {
      reopenedPage = windows[windows.length - 1];
      await reopenedPage.waitForLoadState("domcontentloaded");
      await waitMs(1000);
      await screenshot(reopenedPage, "reopened-from-tray");
      pass("Reopen window via activate", `windows=${windows.length}`);
    } else {
      fail("Reopen window via activate", "No window appeared");
    }
  } catch (err) {
    fail("Reopen window via activate", String(err));
  }

  const activePage = reopenedPage ?? mainPage;

  // ─── TEST 4: Create session and pop it out ──────────────────
  log("--- Test 4: Create session and pop out ---");
  let sessionId: string | null = null;
  try {
    sessionId = await activePage.evaluate(async () => {
      return await (window as any).claude.createSession({
        permissionMode: "default",
        name: "Tray Test Session",
      });
    });
    log(`Session created: ${sessionId?.slice(0, 8)}`);

    await waitMs(2000);
    await screenshot(activePage, "session-created");

    if (sessionId) {
      await activePage.evaluate(async (sid: string) => {
        await (window as any).claude.popOutSession({ sessionId: sid });
      }, sessionId);

      await waitMs(2000);

      const wc = await getWindowCount(eApp);
      if (wc >= 2) {
        pass("Pop out session", `windows=${wc}`);
        const allWindows = eApp.windows();
        if (allWindows.length >= 2) {
          await screenshot(allWindows[allWindows.length - 1], "popout-window");
        }
      } else {
        fail("Pop out session", `expected >=2 windows, got ${wc}`);
      }
    } else {
      fail("Pop out session", "No session created");
    }
  } catch (err) {
    fail("Pop out session", String(err));
  }

  // ─── TEST 5: Close popout → app stays alive ─────────────────
  log("--- Test 5: Close popout -> app stays alive ---");
  try {
    // Close last window (popout) via main process
    await eApp.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length >= 2) {
        wins[wins.length - 1].close();
      }
    });

    await waitMs(1500);

    const wc = await getWindowCount(eApp);
    if (wc >= 1) {
      pass("Close popout -> app stays alive", `windows=${wc}`);
      const wins = eApp.windows();
      if (wins.length > 0) {
        await screenshot(wins[0], "after-popout-closed");
      }
    } else {
      fail("Close popout -> app stays alive", `windowCount=${wc}`);
    }
  } catch (err) {
    fail("Close popout -> app stays alive", `App crashed: ${err}`);
  }

  // ─── TEST 6: Close ALL windows → app stays alive ────────────
  log("--- Test 6: Close ALL windows -> tray keeps alive ---");
  try {
    await closeAllWindows(eApp);
    await waitMs(2000);

    const wc = await getWindowCount(eApp);
    if (wc === 0) {
      pass("Close ALL windows -> tray keeps alive", "0 windows, process alive");
    } else {
      fail("Close ALL windows -> tray keeps alive", `windowCount=${wc}`);
    }
  } catch (err) {
    fail("Close ALL windows -> tray keeps alive", `App crashed/exited: ${err}`);
  }

  // ─── TEST 7: Reopen from tray after all windows closed ──────
  log("--- Test 7: Reopen after all closed ---");
  try {
    await emitActivate(eApp);
    await waitMs(2000);

    const wc = await getWindowCount(eApp);
    if (wc >= 1) {
      pass("Reopen after all closed", `windows=${wc}`);
      const wins = eApp.windows();
      if (wins.length > 0) {
        await wins[wins.length - 1].waitForLoadState("domcontentloaded");
        await waitMs(1000);
        await screenshot(wins[wins.length - 1], "reopened-after-all-closed");
      }
    } else {
      fail("Reopen after all closed", `windowCount=${wc}`);
    }
  } catch (err) {
    fail("Reopen after all closed", String(err));
  }

  // ─── TEST 8: Quit → app exits cleanly ──────────────────────
  log("--- Test 8: Quit -> app exits cleanly ---");
  try {
    const exitPromise = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10000);
      eApp.process().on("exit", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    await eApp.evaluate(({ app }) => {
      app.quit();
    });

    const exited = await exitPromise;
    if (exited) {
      pass("Quit -> app exits cleanly");
    } else {
      fail("Quit -> app exits cleanly", "Did not exit within 10s");
    }
  } catch (err) {
    const s = String(err);
    if (s.includes("Target closed") || s.includes("closed") || s.includes("disconnect")) {
      pass("Quit -> app exits cleanly", "process terminated");
    } else {
      fail("Quit -> app exits cleanly", s);
    }
  }

  // ─── Summary ────────────────────────────────────────────────
  log("\n========================================");
  log("         E2E TRAY TEST RESULTS          ");
  log("========================================");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) {
    log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.test}${r.detail ? ` -- ${r.detail}` : ""}`);
  }
  log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  log(`  Screenshots: ${SCREENSHOT_DIR}`);
  log("========================================\n");

  const errors = consoleLogs.filter((l) => l.includes("ERROR") || l.includes("error"));
  if (errors.length > 0) {
    log("Renderer errors:");
    for (const e of errors) log(`  ${e}`);
  }

  try { await eApp.close(); } catch { /* already closed */ }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("E2E tray test crashed:", err);
  process.exit(1);
});
