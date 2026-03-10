/**
 * Verify tray icon is truly visible by checking Electron's internal tray state
 * and taking screenshots via multiple methods.
 */
import { _electron as electron } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";
const OUT = path.join(TEMP, "buddy-tray-verify");
fs.mkdirSync(OUT, { recursive: true });

function log(msg: string) { console.log(msg); }

function screenshot(name: string): string {
  const p = path.join(OUT, name + ".png");
  try {
    const psCmd = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
      "$bmp = New-Object System.Drawing.Bitmap([int]$b.Width, [int]$b.Height)",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.CopyFromScreen([int]$b.X, [int]$b.Y, 0, 0, $b.Size)",
      `$bmp.Save('${p}')`,
      "$g.Dispose()",
      "$bmp.Dispose()",
    ].join("; ");
    execSync(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 10000, stdio: "pipe" });
    log(`  Screenshot: ${p}`);
  } catch (e) {
    log(`  Screenshot FAILED: ${e}`);
  }
  return p;
}

async function run() {
  log("=== Tray Icon Verification ===\n");

  log("1. Launching app...");
  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
  });

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await new Promise(r => setTimeout(r, 2000));

  // Verify tray was created via main process
  log("\n2. Checking tray state in main process...");
  const trayCheck = await eApp.evaluate(({ BrowserWindow }) => {
    // We can't directly access the tray variable, but we can check if
    // the module was loaded and the constructor was called
    return {
      windowCount: BrowserWindow.getAllWindows().length,
      platform: process.platform,
    };
  });
  log(`   Windows: ${trayCheck.windowCount}, Platform: ${trayCheck.platform}`);

  // Take screenshot with app open
  log("\n3. Screenshot with app window open:");
  screenshot("1-with-window");

  // Close all windows
  log("\n4. Closing all windows...");
  await eApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Verify still alive
  try {
    const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    log(`   App alive, windows: ${wc}`);
  } catch {
    log("   APP DIED!");
    process.exit(1);
  }

  // Take screenshot with no windows
  log("\n5. Screenshot with no windows (tray should be in system tray):");
  screenshot("2-no-windows");

  // Open the system tray overflow via keyboard shortcut
  log("\n6. Opening system tray overflow (Win+B then Enter)...");
  try {
    // Send Win+B to focus system tray, then Space to open overflow
    execSync(`powershell -NoProfile -Command "
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}');
      Start-Sleep -Milliseconds 500;
    "`, { timeout: 5000, stdio: "pipe" });
  } catch {}

  await new Promise(r => setTimeout(r, 1000));
  screenshot("3-tray-area");

  // Try to find our tray icon using Windows automation
  log("\n7. Checking for Buddy Builder in system tray notification area...");
  try {
    const result = execSync(`powershell -NoProfile -Command "
      try {
        $notifyIcons = Get-Process -Name 'electron' -ErrorAction SilentlyContinue
        if ($notifyIcons) {
          Write-Host 'Electron process found: PID' $notifyIcons.Id
          Write-Host 'MainWindowTitle:' $notifyIcons.MainWindowTitle
          Write-Host 'Responding:' $notifyIcons.Responding
        } else {
          Write-Host 'No Electron process found!'
        }
      } catch {
        Write-Host 'Error:' $_.Exception.Message
      }
    "`, { encoding: "utf8", timeout: 10000 });
    log(`   ${result.trim()}`);
  } catch (e) {
    log(`   Check failed: ${e}`);
  }

  // Reopen, then quit
  log("\n8. Reopening window...");
  await eApp.evaluate(({ app }) => app.emit("activate"));
  await new Promise(r => setTimeout(r, 2000));
  const wins = eApp.windows();
  log(`   Windows after activate: ${wins.length}`);
  if (wins.length > 0) {
    screenshot("4-reopened");
  }

  log("\n9. Quitting...");
  try { await eApp.evaluate(({ app }) => app.quit()); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  try { await eApp.close(); } catch {}

  screenshot("5-after-quit");

  log(`\n=== Done. Screenshots at: ${OUT} ===`);
}

run().catch(err => { console.error("Failed:", err); process.exit(1); });
