/**
 * Launch the real Electron app, close its window programmatically,
 * verify process stays alive, capture taskbar screenshot, then quit.
 */
import { _electron as electron } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";
const OUT = path.join(TEMP, "buddy-e2e-tray");
fs.mkdirSync(OUT, { recursive: true });

function log(msg: string) { console.log(`[TEST] ${msg}`); }

function captureTaskbar(name: string) {
  const p = path.join(OUT, name + ".png");
  try {
    // Capture bottom 50px of screen (taskbar)
    execSync(`powershell -NoProfile -Command "
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $w = [int][System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width;
      $h = [int][System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height;
      $ty = $h - 50;
      $bmp = New-Object System.Drawing.Bitmap($w, 50);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen(0, $ty, 0, 0, (New-Object System.Drawing.Size($w, 50)));
      $bmp.Save('${p.replace(/\\/g, "\\\\")}');
      $g.Dispose(); $bmp.Dispose();
    "`, { timeout: 10000 });
    log(`Taskbar screenshot: ${p}`);
  } catch (err) {
    log(`Taskbar capture failed: ${err}`);
  }
  return p;
}

function captureSystemTrayArea(name: string) {
  const p = path.join(OUT, name + ".png");
  try {
    // Capture right quarter of bottom 50px (system tray area)
    execSync(`powershell -NoProfile -Command "
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $w = [int][System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width;
      $h = [int][System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height;
      $captureW = [int]($w / 3);
      $captureX = $w - $captureW;
      $captureY = $h - 50;
      $bmp = New-Object System.Drawing.Bitmap($captureW, 50);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($captureX, $captureY, 0, 0, (New-Object System.Drawing.Size($captureW, 50)));
      $bmp.Save('${p.replace(/\\/g, "\\\\")}');
      $g.Dispose(); $bmp.Dispose();
    "`, { timeout: 10000 });
    log(`System tray screenshot: ${p}`);
  } catch (err) {
    log(`System tray capture failed: ${err}`);
  }
  return p;
}

async function run() {
  log("=== Real Tray Test ===");

  // Capture taskbar before launch
  captureTaskbar("taskbar-0-before");

  log("Launching Electron app...");
  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });

  // Pipe main process output
  eApp.process().stdout?.on("data", (d: Buffer) => process.stdout.write("[main] " + d.toString()));
  eApp.process().stderr?.on("data", (d: Buffer) => { /* suppress debugger msgs */ });

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await new Promise((r) => setTimeout(r, 3000));

  log("App window is loaded");
  captureTaskbar("taskbar-1-app-open");
  captureSystemTrayArea("systray-1-app-open");

  // Close all windows
  log("Closing all windows...");
  await eApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });

  await new Promise((r) => setTimeout(r, 3000));

  // Check app is alive
  let alive = false;
  try {
    const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    alive = true;
    log(`After close-all: App ALIVE, windows=${wc}`);
  } catch (err) {
    log(`After close-all: App DEAD — ${String(err).slice(0, 100)}`);
  }

  if (alive) {
    captureTaskbar("taskbar-2-no-windows");
    captureSystemTrayArea("systray-2-no-windows");

    // Also check the Electron PID is still running
    const pid = eApp.process().pid;
    log(`Electron PID: ${pid}`);
    try {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8", timeout: 5000 });
      log(`Process check: ${output.trim()}`);
    } catch {}

    // Check tray info from main process
    const trayInfo = await eApp.evaluate(({ BrowserWindow, app }) => {
      return {
        windowCount: BrowserWindow.getAllWindows().length,
        appIsReady: app.isReady(),
      };
    });
    log(`Tray diagnostics: ${JSON.stringify(trayInfo)}`);

    // Reopen window
    log("Reopening via activate...");
    await eApp.evaluate(({ app }) => app.emit("activate"));
    await new Promise((r) => setTimeout(r, 2000));

    const wins = eApp.windows();
    if (wins.length > 0) {
      log(`Window reopened! Count: ${wins.length}`);
      captureTaskbar("taskbar-3-reopened");
    } else {
      log("FAIL: No window after activate");
    }
  }

  // Quit
  log("Quitting...");
  try { await eApp.evaluate(({ app }) => app.quit()); } catch {}
  await new Promise((r) => setTimeout(r, 1000));
  try { await eApp.close(); } catch {}

  captureTaskbar("taskbar-4-after-quit");

  log("\n=== DONE ===");
  log(`Screenshots at: ${OUT}`);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
