/**
 * Diagnostic: check if tray is actually created, what __dirname resolves to,
 * and whether the icon loads.
 */
import { _electron as electron } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log("Launching app for tray diagnostics...");

  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await new Promise((r) => setTimeout(r, 2000));

  // Check __dirname from inside the main process
  const diag = await eApp.evaluate(({ app, BrowserWindow, Tray, nativeImage }) => {
    const path = require("path");
    const fs = require("fs");
    const dir = __dirname;
    const assetsDir = path.join(dir, "assets");
    const icoPath = path.join(assetsDir, "icon.ico");
    const png16Path = path.join(assetsDir, "icon-16.png");

    // Check files
    const icoExists = fs.existsSync(icoPath);
    const png16Exists = fs.existsSync(png16Path);

    let icoSize = 0;
    try { icoSize = fs.statSync(icoPath).size; } catch {}

    // Try loading the icon
    let iconEmpty = true;
    let iconError = "";
    try {
      const img = nativeImage.createFromPath(icoPath);
      iconEmpty = img.isEmpty();
    } catch (err: any) {
      iconError = err.message;
    }

    // Check if any Tray instances exist (Electron doesn't expose this easily)
    // But we can check window count as proxy
    const windowCount = BrowserWindow.getAllWindows().length;

    return {
      dirname: dir,
      assetsDir,
      icoPath,
      icoExists,
      icoSize,
      png16Exists,
      iconEmpty,
      iconError,
      windowCount,
      platform: process.platform,
    };
  });

  console.log("\n=== TRAY DIAGNOSTICS ===");
  console.log("__dirname:", diag.dirname);
  console.log("assetsDir:", diag.assetsDir);
  console.log("icoPath:", diag.icoPath);
  console.log("icoExists:", diag.icoExists);
  console.log("icoSize:", diag.icoSize, "bytes");
  console.log("png16Exists:", diag.png16Exists);
  console.log("iconEmpty:", diag.iconEmpty);
  console.log("iconError:", diag.iconError || "(none)");
  console.log("windowCount:", diag.windowCount);
  console.log("platform:", diag.platform);

  // Now try to directly create a tray from the main process to see if it errors
  console.log("\n=== Testing direct tray creation ===");
  const trayResult = await eApp.evaluate(({ Tray, Menu, nativeImage }) => {
    const path = require("path");
    const assetsDir = path.join(__dirname, "assets");

    try {
      const icoPath = path.join(assetsDir, "icon.ico");
      const icon = nativeImage.createFromPath(icoPath);
      if (icon.isEmpty()) {
        return { ok: false, error: "nativeImage is EMPTY after loading ico" };
      }

      const testTray = new Tray(icon);
      testTray.setToolTip("Diag Test");
      const menu = Menu.buildFromTemplate([{ label: "Test", click: () => {} }]);
      testTray.setContextMenu(menu);

      // Destroy it after test
      setTimeout(() => testTray.destroy(), 5000);
      return { ok: true, error: "" };
    } catch (err: any) {
      return { ok: false, error: err.message + "\n" + err.stack };
    }
  });

  console.log("Tray creation result:", trayResult);

  // Check if the module-level tray was created by looking at tray.ts export
  console.log("\n=== Checking if createTray was called ===");
  // We can't directly access module scope, but let's check console output
  const mainLogs = await eApp.evaluate(() => {
    // Check if there were any errors during startup
    return { processUptime: process.uptime() };
  });
  console.log("Process uptime:", mainLogs.processUptime, "seconds");

  // Close windows and check if app stays alive
  console.log("\n=== Testing close-all-windows ===");
  await eApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
  await new Promise((r) => setTimeout(r, 3000));

  try {
    const alive = await eApp.evaluate(({ BrowserWindow }) => {
      return { alive: true, windowCount: BrowserWindow.getAllWindows().length };
    });
    console.log("After closing all windows:", alive);
  } catch (err) {
    console.log("App DIED after closing all windows:", String(err));
  }

  // Cleanup
  try {
    await eApp.evaluate(({ app }) => app.quit());
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
  try { await eApp.close(); } catch {}

  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Diag failed:", err);
  process.exit(1);
});
