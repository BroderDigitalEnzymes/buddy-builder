/**
 * Test detached launch (simulates new start.bat behavior).
 *
 * Launches electron via child_process.spawn (detached, like `start "" npx electron`),
 * then uses Playwright to connect and verify tray survival.
 *
 * Run:  npx tsx scripts/test-detached-launch.ts
 */

import { spawn, execSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function log(msg: string) { console.log(`[DETACH-TEST] ${msg}`); }

function checkElectronAlive(): boolean {
  try {
    const out = execSync("tasklist /FI \"IMAGENAME eq electron.exe\" /FO CSV /NH", { encoding: "utf-8", timeout: 5000 });
    return out.includes("electron.exe");
  } catch { return false; }
}

function getElectronPids(): number[] {
  try {
    const out = execSync("tasklist /FI \"IMAGENAME eq electron.exe\" /FO CSV /NH", { encoding: "utf-8", timeout: 5000 });
    const pids: number[] = [];
    for (const line of out.split("\n")) {
      const match = line.match(/"electron\.exe","(\d+)"/);
      if (match) pids.push(parseInt(match[1]));
    }
    return pids;
  } catch { return []; }
}

async function wait(ms: number) { await new Promise(r => setTimeout(r, ms)); }

async function run() {
  log("=== Kill any existing electron processes ===");
  try { execSync("taskkill /F /IM electron.exe 2>nul", { encoding: "utf-8" }); } catch {}
  await wait(1000);

  log("=== Launching electron DETACHED (like start.bat) ===");

  // This simulates: start "" npx electron dist\main.cjs
  // Using shell: true + detached: true + unref() — the parent can exit and electron keeps running
  const mainScript = path.join(__dirname, "..", "dist", "main.cjs");

  // On Windows, electron in .bin is a .cmd — need shell: true
  const child = spawn("npx", ["electron", mainScript], {
    detached: true,
    stdio: "ignore",
    shell: true,
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, BUDDY_TEST: "0" },
  });
  child.unref();

  const childPid = child.pid;
  log(`Spawned detached electron, PID: ${childPid}`);

  // Wait for app to fully start
  log("Waiting 5s for app startup...");
  await wait(5000);

  // Check electron is running
  const pidsAfterLaunch = getElectronPids();
  log(`Electron PIDs after launch: ${pidsAfterLaunch.join(", ")}`);

  if (pidsAfterLaunch.length === 0) {
    log("FAIL: No electron.exe process found after launch!");
    process.exit(1);
  }
  log("PASS: Electron is running");

  // Now simulate window close by sending WM_CLOSE via PowerShell script
  log("\n=== Sending WM_CLOSE to Electron window ===");
  try {
    const psScript = path.join(__dirname, "close-electron-window.ps1");
    const pidArgs = pidsAfterLaunch.join(" ");
    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${psScript}" -Pids ${pidArgs}`,
      { encoding: "utf-8", timeout: 15000 }
    );
    if (out.trim()) log(out.trim());
  } catch (err) {
    log(`WM_CLOSE send error: ${err}`);
  }

  log("Waiting 5s after WM_CLOSE...");
  await wait(5000);

  // Check if electron is STILL alive
  const pidsAfterClose = getElectronPids();
  log(`Electron PIDs after WM_CLOSE: ${pidsAfterClose.join(", ") || "(none)"}`);

  if (pidsAfterClose.length > 0) {
    log("\nPASS: Electron survived window close! Tray mode works.");
    log("The app is running headless with tray icon.");
  } else {
    log("\nFAIL: Electron died after window close.");
  }

  // Cleanup
  log("\n=== Cleanup: killing electron processes ===");
  try { execSync("taskkill /F /IM electron.exe 2>nul", { encoding: "utf-8" }); } catch {}

  log("Done.");
  process.exit(pidsAfterClose.length > 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
