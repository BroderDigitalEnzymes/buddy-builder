/**
 * Visual tray test: launch app, close all windows, take a screenshot
 * of the entire screen to verify tray icon is visible.
 * Then reopen and verify everything works.
 */
import { _electron as electron } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";
const SCREENSHOT_DIR = path.join(TEMP, "buddy-e2e-tray");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let step = 0;

function log(msg: string) {
  console.log(`[TEST] ${msg}`);
}

async function desktopScreenshot(name: string): Promise<string> {
  step++;
  const p = path.join(SCREENSHOT_DIR, `${step}-${name}.png`);
  try {
    // Use PowerShell to take a full desktop screenshot
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bmp.Save("${p.replace(/\\/g, "\\\\")}")
      $g.Dispose()
      $bmp.Dispose()
    `.trim();
    execSync(`powershell -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`, { timeout: 10000 });
    log(`Desktop screenshot: ${p}`);
  } catch (err) {
    log(`Desktop screenshot failed: ${err}`);
  }
  return p;
}

async function windowScreenshot(page: any, name: string): Promise<string> {
  step++;
  const p = path.join(SCREENSHOT_DIR, `${step}-${name}.png`);
  try {
    await page.screenshot({ path: p });
    log(`Window screenshot: ${p}`);
  } catch {
    log(`Window screenshot failed: ${name}`);
  }
  return p;
}

async function waitMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function run() {
  log("=== Visual Tray Test ===");
  log(`Screenshots: ${SCREENSHOT_DIR}`);

  // Step 0: Desktop before launch
  await desktopScreenshot("desktop-before-launch");

  // Launch
  log("Launching app...");
  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });

  const proc = eApp.process();
  proc.stdout?.on("data", (d: Buffer) => process.stdout.write("[main] " + d.toString()));
  proc.stderr?.on("data", (d: Buffer) => process.stderr.write("[main:err] " + d.toString()));

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await waitMs(2000);

  // Screenshot 1: App window open
  await windowScreenshot(page, "app-open");
  await desktopScreenshot("desktop-app-open");

  // Close all windows
  log("Closing all windows...");
  await eApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
  await waitMs(3000);

  // Screenshot 2: Desktop with no windows (tray should be visible)
  await desktopScreenshot("desktop-no-windows-tray-should-show");

  // Check app alive
  try {
    const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    log(`App alive, windows: ${wc}`);
  } catch (err) {
    log(`APP DIED: ${err}`);
  }

  // Reopen via activate
  log("Reopening via activate...");
  await eApp.evaluate(({ app }) => {
    app.emit("activate");
  });
  await waitMs(2000);

  const wins = eApp.windows();
  if (wins.length > 0) {
    await wins[wins.length - 1].waitForLoadState("domcontentloaded");
    await waitMs(1000);
    await windowScreenshot(wins[wins.length - 1], "reopened-window");
    log("Window reopened successfully");
  } else {
    log("FAIL: No window after activate");
  }

  await desktopScreenshot("desktop-after-reopen");

  // Quit
  try {
    await eApp.evaluate(({ app }) => app.quit());
  } catch {}
  await waitMs(1000);
  try { await eApp.close(); } catch {}

  await desktopScreenshot("desktop-after-quit");

  log("\n=== Done ===");
  log(`Check screenshots in: ${SCREENSHOT_DIR}`);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
