import { _electron as electron } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";

async function screenshot(window: any, name: string): Promise<string> {
  const p = path.join(TEMP, `buddy-e2e-${name}.png`);
  await window.screenshot({ path: p });
  console.log(`[SCREENSHOT] ${p}`);
  return p;
}

async function run() {
  console.log("=== Launching Electron app ===");

  const app = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
  });

  const window = await app.firstWindow();
  console.log("=== Window opened ===");

  const logs: string[] = [];
  window.on("console", (msg: any) => {
    const line = `[console.${msg.type()}] ${msg.text()}`;
    logs.push(line);
    console.log(line);
  });
  window.on("pageerror", (err: any) => {
    const line = `[PAGE ERROR] ${err.message}`;
    logs.push(line);
    console.log(line);
  });

  await window.waitForLoadState("domcontentloaded");
  await new Promise((r) => setTimeout(r, 1000));

  // Screenshot 1: initial state (empty, no session)
  await screenshot(window, "1-initial");

  const hasNewSession = await window.isVisible("#new-session");
  const hasInput = await window.isVisible("#input");
  const hasSend = await window.isVisible("#send");
  console.log(`[DOM] newSession=${hasNewSession} input=${hasInput} send=${hasSend}`);

  // ─── Create session ────────────────────────────────────────────
  console.log("=== Clicking + New ===");
  await window.click("#new-session");
  await new Promise((r) => setTimeout(r, 3000));

  await screenshot(window, "2-session-created");

  const sessionCount = await window.locator(".session-item").count();
  console.log(`[DOM] sessions=${sessionCount}`);

  // ─── Test 1: Simple message (triggers Read tool) ───────────────
  console.log("=== Sending test message (Read tool) ===");
  const inputEl = window.locator("#input");

  await inputEl.click();
  await inputEl.fill("Read package.json and tell me the project name.");
  const inputVal = await inputEl.inputValue();
  console.log(`[DOM] input value after fill="${inputVal}"`);

  const sendEl = window.locator("#send");
  await sendEl.click();
  await new Promise((r) => setTimeout(r, 500));

  const inputValAfter = await inputEl.inputValue();
  console.log(`[DOM] input cleared after send=${inputValAfter === ""}`);

  const msgCountAfterSend = await window.locator(".msg-row").count();
  console.log(`[DOM] message rows after send=${msgCountAfterSend}`);

  // Check new layout elements
  const hasAvatar = await window.locator(".msg-avatar").count();
  const hasSender = await window.locator(".msg-sender").count();
  console.log(`[DOM] avatars=${hasAvatar} sender-labels=${hasSender}`);

  // Wait for tool to start (spinner visible)
  console.log("=== Waiting for tool activity ===");
  try {
    await window.locator(".tool-entry").first().waitFor({ timeout: 15000 });
    console.log("[OK] Tool entry appeared");
    await screenshot(window, "3-tool-running");
  } catch {
    console.log("[WARN] No tool entry appeared within timeout");
  }

  // Wait for result
  console.log("=== Waiting for response ===");
  try {
    await window.locator(".msg-result-inner").first().waitFor({ timeout: 30000 });
    console.log("[OK] Got result entry");
  } catch {
    console.log("[WARN] Timed out waiting for result");
  }

  await new Promise((r) => setTimeout(r, 500));
  await screenshot(window, "4-response-complete");

  const msgCount = await window.locator(".msg-row").count();
  const toolCount = await window.locator(".tool-entry").count();
  const hasResult = await window.locator(".msg-result-inner").count();
  console.log(`[DOM] messages=${msgCount} tools=${toolCount} results=${hasResult}`);

  // Check message grouping (avatar should appear once for "You", once for "Claude")
  const avatarCount = await window.locator(".msg-avatar").count();
  const continuationCount = await window.locator(".msg-row-continuation").count();
  console.log(`[DOM] avatar-headers=${avatarCount} continuation-rows=${continuationCount}`);

  // Read assistant text
  const assistantText = await window.locator(".msg-text").first().textContent().catch(() => "(none)");
  console.log(`[DOM] first msg-text: ${assistantText?.slice(0, 200)}`);

  // ─── Test 2: Bash tool (multi-second, test running state) ──────
  console.log("=== Sending bash command (tool-use test) ===");
  await inputEl.click();
  await inputEl.fill("Run this bash command: ping -n 3 127.0.0.1");
  await sendEl.click();
  await new Promise((r) => setTimeout(r, 1000));

  // Take screenshot while bash is running
  const runningTools = await window.locator(".tool-entry.tool-running").count();
  console.log(`[DOM] running tools=${runningTools}`);
  await screenshot(window, "5-bash-running");

  // Wait for bash to complete
  try {
    // Wait for a second result entry (the one from this message)
    await window.locator(".msg-result-inner").nth(1).waitFor({ timeout: 30000 });
    console.log("[OK] Bash command completed");
  } catch {
    console.log("[WARN] Bash command timed out");
  }

  await new Promise((r) => setTimeout(r, 500));
  await screenshot(window, "6-bash-complete");

  // Check tool states after completion
  const doneTools = await window.locator(".tool-done").count();
  const totalTools = await window.locator(".tool-entry").count();
  console.log(`[DOM] done-tools=${doneTools} total-tools=${totalTools}`);

  // ─── Test 3: Policy switch ─────────────────────────────────────
  console.log("=== Testing policy switch ===");
  const readOnlyBtn = window.locator('.policy-btn[data-preset="read-only"]');
  if (await readOnlyBtn.isVisible()) {
    await readOnlyBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    await screenshot(window, "7-policy-readonly");
  }

  // ─── Test 4: Screenshot via IPC (test the takeScreenshot handler) ──
  console.log("=== Testing takeScreenshot IPC ===");
  try {
    const ssPath = await window.evaluate(() =>
      (window as any).claude.takeScreenshot({ filename: "buddy-e2e-ipc-screenshot.png" })
    );
    console.log(`[OK] IPC screenshot saved: ${ssPath}`);
  } catch (err) {
    console.log(`[WARN] IPC screenshot failed: ${err}`);
  }

  // ─── Summary ───────────────────────────────────────────────────
  console.log("\n=== Console log summary ===");
  const errors = logs.filter((l) => l.includes("ERROR") || l.includes("error") || l.includes("Error"));
  if (errors.length > 0) {
    console.log("ERRORS FOUND:");
    for (const e of errors) console.log("  ", e);
  } else {
    console.log("No errors detected.");
  }

  console.log("\n=== Closing ===");
  await app.close();
}

run().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});
