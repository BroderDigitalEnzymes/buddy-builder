/**
 * Test the packaged native .exe — launch it, close the window, verify tray survival.
 *
 * Run:  npx tsx scripts/test-native-exe.ts
 */

import { execSync, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXE_PATH = path.join(__dirname, "..", "release", "win-unpacked", "Buddy Builder.exe");
const SCREENSHOT_DIR = path.join(process.env.TEMP ?? "/tmp", "buddy-exe-test");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(msg: string) { console.log(`[EXE-TEST] ${msg}`); }

function findProcessByName(name: string): number[] {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${name}" /FO CSV /NH`, { encoding: "utf-8", timeout: 5000 });
    const pids: number[] = [];
    for (const line of out.split("\n")) {
      const match = line.match(new RegExp(`"${name.replace(".", "\\.")}","(\\d+)"`));
      if (match) pids.push(parseInt(match[1]));
    }
    return pids;
  } catch { return []; }
}

function nativeScreenshot(name: string): void {
  const outPath = path.join(SCREENSHOT_DIR, `${name}.png`);
  try {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${outPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;
    execSync(`powershell -Command "${ps.replace(/\n/g, "; ")}"`, { timeout: 10000 });
    log(`Screenshot: ${outPath}`);
  } catch { log(`Screenshot failed: ${name}`); }
}

async function wait(ms: number) { await new Promise(r => setTimeout(r, ms)); }

async function run() {
  log("════════════════════════════════════════");
  log("   NATIVE EXE TRAY TEST");
  log("════════════════════════════════════════");
  log(`Exe: ${EXE_PATH}`);
  log(`Exists: ${fs.existsSync(EXE_PATH)}`);

  // Kill any existing instances
  try { execSync('taskkill /F /IM "Buddy Builder.exe" 2>nul', { encoding: "utf-8" }); } catch {}
  await wait(1000);

  // Launch the native exe
  log("\n[1] Launching native exe...");
  const child = spawn(EXE_PATH, [], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  log(`Spawned PID: ${child.pid}`);

  // Wait for app to start
  log("Waiting 8s for startup...");
  await wait(8000);

  let pids = findProcessByName("Buddy Builder.exe");
  log(`Buddy Builder PIDs: ${pids.join(", ") || "(none)"}`);
  nativeScreenshot("01-after-launch");

  if (pids.length === 0) {
    log("FAIL: No Buddy Builder process found!");
    process.exit(1);
  }
  log("PASS: Native exe is running");

  // Send WM_CLOSE to close the window
  log("\n[2] Sending WM_CLOSE to close window...");
  const psScript = path.join(__dirname, "close-electron-window.ps1");
  try {
    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${psScript}" -Pids ${pids.join(" ")}`,
      { encoding: "utf-8", timeout: 15000 }
    );
    log(out.trim());
  } catch (err) {
    log(`WM_CLOSE error: ${err}`);
  }

  log("Waiting 5s after close...");
  await wait(5000);
  nativeScreenshot("02-after-close");

  // Check survival
  pids = findProcessByName("Buddy Builder.exe");
  log(`Buddy Builder PIDs after close: ${pids.join(", ") || "(none)"}`);

  if (pids.length > 0) {
    log("\nPASS: Native exe survived window close! Tray mode works.");
  } else {
    log("\nFAIL: Native exe died after window close!");
  }

  // Test reopen: send a second WM_CLOSE should do nothing (no window)
  // Just verify it's still alive after 5 more seconds
  log("\nWaiting 5 more seconds to confirm stability...");
  await wait(5000);
  const finalPids = findProcessByName("Buddy Builder.exe");
  log(`Final PIDs: ${finalPids.join(", ") || "(none)"}`);
  if (finalPids.length > 0) {
    log("PASS: Process stable in tray mode.");
  } else {
    log("FAIL: Process died during tray mode.");
  }

  // Cleanup
  log("\n[3] Cleanup...");
  try { execSync('taskkill /F /IM "Buddy Builder.exe" 2>nul', { encoding: "utf-8" }); } catch {}
  log(`Screenshots: ${SCREENSHOT_DIR}`);
  log("Done.");

  process.exit(finalPids.length > 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
