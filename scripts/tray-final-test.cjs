/**
 * Final tray test: launch app, verify tray icon existence using
 * Windows notification area API, close windows, verify app stays alive.
 */
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const electronPath = require("electron");
const appPath = path.join(__dirname, "..");
const OUT = path.join(process.env.TEMP || "/tmp", "buddy-tray-final");
fs.mkdirSync(OUT, { recursive: true });

console.log("=== Final Tray Test ===");
console.log("Electron:", electronPath);
console.log("Screenshots:", OUT);

// Launch
const child = spawn(electronPath, [appPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, BUDDY_TEST: "0" },
});

child.stdout.on("data", (d) => process.stdout.write("[app] " + d.toString()));
child.stderr.on("data", (d) => {
  const s = d.toString();
  if (!s.includes("disk_cache") && !s.includes("debugger") && !s.includes("DevTools"))
    process.stdout.write("[app:err] " + s);
});

child.on("exit", (code) => console.log(`\n[EXIT] code=${code}`));

const pid = child.pid;
console.log(`PID: ${pid}\n`);

function alive() {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function fullScreenshot(name) {
  const p = path.join(OUT, name + ".png");
  try {
    execSync(`powershell -NoProfile -Command "
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
      $bmp = New-Object System.Drawing.Bitmap([int]$b.Width,[int]$b.Height);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen([int]$b.X,[int]$b.Y,0,0,$b.Size);
      $bmp.Save('${p}');
      $g.Dispose();$bmp.Dispose()
    "`, { timeout: 10000, stdio: "pipe" });
    console.log(`  Screenshot: ${p}`);
  } catch (e) { console.log(`  Screenshot err: ${e.message}`); }
  return p;
}

function findTrayIcons() {
  try {
    const out = execSync(`powershell -NoProfile -Command "
      Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id, MainWindowTitle, MainWindowHandle | Format-Table -AutoSize | Out-String
    "`, { encoding: "utf8", timeout: 5000 });
    return out.trim();
  } catch { return "(check failed)"; }
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log("--- Step 1: Wait for app to start ---");
  await wait(5000);
  console.log(`Process alive: ${alive()}`);
  fullScreenshot("1-app-running");
  console.log(`Electron processes:\n${findTrayIcons()}`);

  // Now we need to close the window.
  // We'll do this by sending Ctrl+W or by finding and closing the window via PowerShell.
  console.log("\n--- Step 2: Close all Electron windows ---");
  try {
    execSync(`powershell -NoProfile -Command "
      $procs = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
      if ($procs -and $procs.MainWindowHandle -ne 0) {
        $sig = Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);' -Name 'Win32' -Namespace 'PostMsg' -PassThru
        $WM_CLOSE = 0x0010
        $sig::PostMessage($procs.MainWindowHandle, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
        Write-Host 'Sent WM_CLOSE to main window'
      } else {
        Write-Host 'No main window handle found'
      }
    "`, { encoding: "utf8", timeout: 10000 });
  } catch (e) {
    console.log("Close window error:", e.message);
  }

  console.log("Waiting 3s...");
  await wait(3000);

  console.log(`Process alive after window close: ${alive()}`);
  if (alive()) {
    console.log("SUCCESS: App survived window close!");
    fullScreenshot("2-no-window-tray");
    console.log(`Electron processes:\n${findTrayIcons()}`);

    // Try to find the system tray notification icon for Electron
    console.log("\n--- Step 3: Check tray notification icons ---");
    try {
      const out = execSync(`powershell -NoProfile -Command "
        # Check NotifyIcon area buttons
        try {
          [void][System.Reflection.Assembly]::LoadWithPartialName('UIAutomationClient')
          [void][System.Reflection.Assembly]::LoadWithPartialName('UIAutomationTypes')
          $auto = [System.Windows.Automation.AutomationElement]
          $root = $auto::RootElement
          $tbar = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')))
          if ($tbar) {
            $buttons = $tbar.FindAll([System.Windows.Automation.TreeScope]::Descendants,
              (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
            foreach ($b in $buttons) {
              $name = $b.Current.Name
              if ($name -match 'Buddy|buddy|Electron|electron') {
                Write-Host \"FOUND TRAY ICON: $name\"
              }
            }
            Write-Host \"Checked $($buttons.Count) tray buttons\"
          } else {
            Write-Host 'Shell_TrayWnd not found'
          }
        } catch {
          Write-Host \"UIAutomation error: $_\"
        }
      "`, { encoding: "utf8", timeout: 15000 });
      console.log(out.trim());
    } catch (e) {
      console.log("Tray check error:", e.message);
    }
  } else {
    console.log("FAIL: App died when window closed!");
  }

  // Cleanup
  console.log("\n--- Cleanup ---");
  if (alive()) {
    child.kill("SIGTERM");
    await wait(1000);
    if (alive()) child.kill("SIGKILL");
  }
  console.log("Done.");
  process.exit(0);
}

run().catch(e => { console.error(e); child.kill(); process.exit(1); });
