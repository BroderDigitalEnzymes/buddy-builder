/**
 * Test that reproduces start.bat launch and window close.
 * Launches electron via `npx electron` (same as start.bat) and
 * sends winClose IPC, then checks if process stays alive.
 */

import { _electron as electron } from "playwright";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  // Find the actual electron binary that npx uses
  const electronPath = path.join(__dirname, "..", "node_modules", ".bin", "electron");
  console.log("Electron binary:", electronPath);

  console.log("\n=== Test: Launch like start.bat, close window, check survival ===");
  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });

  // Capture stdout from main process
  eApp.process().stdout?.on("data", (d: Buffer) => process.stdout.write("[main] " + d.toString()));
  eApp.process().stderr?.on("data", (d: Buffer) => process.stderr.write("[main:err] " + d.toString()));

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await new Promise(r => setTimeout(r, 2000));

  console.log("\n--- Checking tray status ---");
  const trayInfo = await eApp.evaluate(({ BrowserWindow, app }) => {
    const allWins = BrowserWindow.getAllWindows().length;
    return { windows: allWins, name: app.getName() };
  });
  console.log("Before close:", trayInfo);

  // Track process exit
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  eApp.process().on("exit", (code, signal) => {
    exitCode = code;
    exitSignal = signal as string;
    console.log(`[PROCESS EXIT] code=${code} signal=${signal}`);
  });

  console.log("\n--- Sending winClose IPC (same as clicking X) ---");
  try {
    await page.evaluate(() => {
      (window as any).claude.winClose();
    });
    console.log("winClose sent");
  } catch (err) {
    console.log("winClose result:", String(err).slice(0, 200));
  }

  console.log("Waiting 5 seconds...");
  await new Promise(r => setTimeout(r, 5000));

  if (exitCode !== null) {
    console.log(`\n!!! APP DIED — exit code=${exitCode} signal=${exitSignal}`);
    console.log("FAIL: App terminated when it should have stayed alive in tray");
  } else {
    console.log("\nApp is STILL ALIVE (process running)");
    try {
      const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      console.log(`Windows remaining: ${wc}`);
      console.log("PASS: App stayed alive in tray after window close");
    } catch (err) {
      console.log("Could not query windows:", String(err).slice(0, 200));
    }
  }

  // Cleanup
  try { await eApp.evaluate(({ app }) => app.quit()); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  try { await eApp.close(); } catch {}
  console.log("Done.");
}

run().catch(err => { console.error(err); process.exit(1); });
