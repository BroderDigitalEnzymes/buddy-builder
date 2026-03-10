/**
 * E2E test: minimizeToTray setting toggle
 *
 * Tests:
 *  1. With minimizeToTray=false → closing all windows quits the app
 *  2. With minimizeToTray=true (default) → closing all windows keeps app alive
 *
 * Run:  npx tsx scripts/e2e-tray-setting-test.ts
 */

import { _electron as electron, type ElectronApplication } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results: { test: string; pass: boolean; detail: string }[] = [];

function log(msg: string) { console.log(`[SETTING-E2E] ${msg}`); }
function pass(test: string, detail = "") { results.push({ test, pass: true, detail }); log(`PASS: ${test}${detail ? ` (${detail})` : ""}`); }
function fail(test: string, detail = "") { results.push({ test, pass: false, detail }); log(`FAIL: ${test}${detail ? ` (${detail})` : ""}`); }
async function waitMs(ms: number) { await new Promise((r) => setTimeout(r, ms)); }

async function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });
}

async function run() {
  log("=== Test 1: minimizeToTray=false → app quits when windows close ===");
  {
    const eApp = await launchApp();
    const page = await eApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await waitMs(2000);

    // Set config minimizeToTray = false
    await page.evaluate(async () => {
      const cfg = await (window as any).claude.getConfig();
      await (window as any).claude.setConfig({ ...cfg, minimizeToTray: false });
    });
    log("Set minimizeToTray=false");

    // Track process exit
    let processExited = false;
    eApp.process().on("exit", () => { processExited = true; });

    // Close all windows
    await eApp.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.close();
    });
    await waitMs(3000);

    if (processExited) {
      pass("minimizeToTray=false → app quits", "process exited after window close");
    } else {
      fail("minimizeToTray=false → app quits", "process still alive");
      try { await eApp.evaluate(({ app }) => app.quit()); } catch {}
    }
    try { await eApp.close(); } catch {}
    await waitMs(1000);
  }

  log("\n=== Test 2: minimizeToTray=true → app stays alive ===");
  {
    const eApp = await launchApp();
    const page = await eApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await waitMs(2000);

    // Set config minimizeToTray = true
    await page.evaluate(async () => {
      const cfg = await (window as any).claude.getConfig();
      await (window as any).claude.setConfig({ ...cfg, minimizeToTray: true });
    });
    log("Set minimizeToTray=true");

    // Close all windows
    await eApp.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.close();
    });
    await waitMs(2000);

    try {
      const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      if (wc === 0) {
        pass("minimizeToTray=true → app stays alive", "0 windows, process alive");
      } else {
        fail("minimizeToTray=true → app stays alive", `unexpected windows=${wc}`);
      }
    } catch (err) {
      fail("minimizeToTray=true → app stays alive", `app died: ${err}`);
    }

    try { await eApp.evaluate(({ app }) => app.quit()); } catch {}
    try { await eApp.close(); } catch {}
  }

  // Summary
  log("\n========================================");
  log("    MINIMIZE-TO-TRAY SETTING TEST       ");
  log("========================================");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) {
    log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.test}${r.detail ? ` -- ${r.detail}` : ""}`);
  }
  log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  log("========================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error("E2E setting test crashed:", err); process.exit(1); });
