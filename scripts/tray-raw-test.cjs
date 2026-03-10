/**
 * Raw test: launch the Electron app as a child process (same as user runs it),
 * monitor its lifetime, check process existence after window would close.
 */
const { spawn, execSync } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const appPath = path.join(__dirname, "..");

console.log("Electron binary:", electronPath);
console.log("App path:", appPath);

// Launch electron
const child = spawn(electronPath, [appPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, BUDDY_TEST: "0" },
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => {
  const s = d.toString();
  stdout += s;
  process.stdout.write("[app:out] " + s);
});
child.stderr.on("data", (d) => {
  const s = d.toString();
  stderr += s;
  // Only show non-debugger messages
  if (!s.includes("debugger") && !s.includes("DevTools")) {
    process.stdout.write("[app:err] " + s);
  }
});

child.on("exit", (code, signal) => {
  console.log(`\n[RESULT] App exited: code=${code} signal=${signal}`);
});

const pid = child.pid;
console.log(`App PID: ${pid}`);

function isProcessAlive(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, {
      encoding: "utf8",
      timeout: 5000,
    });
    return out.includes(`"${pid}"`);
  } catch {
    return false;
  }
}

// Check at intervals
async function monitor() {
  console.log("\n--- Waiting 5s for app to start ---");
  await new Promise((r) => setTimeout(r, 5000));

  console.log(`[CHECK] Process alive: ${isProcessAlive(pid)}`);

  // List all electron-related processes
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', {
      encoding: "utf8",
      timeout: 5000,
    });
    console.log(`[CHECK] Electron processes:\n${out.trim() || "(none)"}`);
  } catch {}

  console.log("\n--- Waiting 15s for user to close window (or auto-timeout) ---");
  console.log("    (The app window should be open now. It will close automatically.)");

  // After 10 more seconds, check if alive
  await new Promise((r) => setTimeout(r, 15000));

  const alive = isProcessAlive(pid);
  console.log(`\n[CHECK] After 15s, process alive: ${alive}`);

  if (alive) {
    // Try to find electron processes
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', {
        encoding: "utf8",
        timeout: 5000,
      });
      console.log(`[CHECK] Electron processes:\n${out.trim() || "(none)"}`);
    } catch {}

    console.log("\n--- Killing app ---");
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    if (isProcessAlive(pid)) {
      child.kill("SIGKILL");
    }
  }

  console.log("\n--- Collected stdout ---");
  console.log(stdout.trim() || "(empty)");
  console.log("\n--- Done ---");
  process.exit(0);
}

monitor().catch((err) => {
  console.error("Monitor error:", err);
  child.kill();
  process.exit(1);
});
