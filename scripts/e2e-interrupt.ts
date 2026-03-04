import { _electron as electron } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";
const LOG_FILE = path.join(TEMP, "buddy-e2e-interrupt.log");
const CWD = path.resolve(__dirname, "..");

// ─── Logging ─────────────────────────────────────────────────────

const logLines: string[] = [];

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  logLines.push(line);
  console.log(line);
}

function flushLog(): void {
  fs.writeFileSync(LOG_FILE, logLines.join("\n") + "\n", "utf-8");
  log(`Log written to ${LOG_FILE}`);
}

// ─── Screenshot helper ───────────────────────────────────────────

async function screenshot(window: any, name: string): Promise<string> {
  const p = path.join(TEMP, `buddy-e2e-interrupt-${name}.png`);
  await window.screenshot({ path: p });
  log(`SCREENSHOT: ${p}`);
  return p;
}

// ─── Wait helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSelector(window: any, selector: string, timeoutMs = 15000): Promise<boolean> {
  try {
    await window.locator(selector).first().waitFor({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

// ─── Main test ───────────────────────────────────────────────────

async function run() {
  log("=== E2E Interrupt Test ===");

  // 1. Launch
  log("Launching Electron app...");
  const app = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env },
  });

  const window = await app.firstWindow();
  log("Window opened.");

  // Capture console + errors
  window.on("console", (msg: any) => log(`[console.${msg.type()}] ${msg.text()}`));
  window.on("pageerror", (err: any) => log(`[PAGE ERROR] ${err.message}`));

  await window.waitForLoadState("domcontentloaded");
  await sleep(2000);
  await screenshot(window, "01-initial");

  // 2. Create a session via store (bypasses folder picker dialog)
  log("Creating session via store...");
  await window.evaluate((cwd: string) => {
    return (window as any).__buddyStore.createSession("bypassPermissions", cwd);
  }, CWD);
  log("  Store createSession returned.");

  // Wait for the session to become active (input enabled)
  log("Waiting for session to be ready (input enabled)...");
  const inputReady = await waitForSelector(window, "#input:not([disabled])", 15000);
  log(`  Input enabled: ${inputReady}`);
  await sleep(1000);
  await screenshot(window, "02-session-created");

  if (!inputReady) {
    log("FAIL: Input never enabled — session didn't start.");
    flushLog();
    await app.close();
    process.exit(1);
  }

  // 3. Send a long prompt
  const inputEl = window.locator("#input");
  const longPrompt = "Write a detailed 500-word essay about the history of computing from the 1940s to present day. Do not use any tools. Just write the essay directly.";
  await inputEl.fill(longPrompt);
  log(`Sending long prompt: "${longPrompt.slice(0, 60)}..."`);

  const sendEl = window.locator("#send");
  await sendEl.click();
  await sleep(500);

  const inputCleared = (await inputEl.inputValue()) === "";
  log(`  Input cleared: ${inputCleared}`);

  // 4. Wait for assistant text to appear
  log("Waiting for assistant text...");
  const textAppeared = await waitForSelector(window, ".msg-text", 20000);
  log(`  Text appeared: ${textAppeared}`);
  await sleep(3000); // Let it generate for a few seconds
  await screenshot(window, "03-generating");

  // 5. Check Stop button
  const stopBtnVisible = await window.locator("#stop-btn").isVisible().catch(() => false);
  log(`  Stop button visible: ${stopBtnVisible}`);

  // 6. Click Stop (interrupt)
  log("Clicking Stop button...");
  if (stopBtnVisible) {
    await window.click("#stop-btn");
  } else {
    log("  Stop button not found, pressing Escape...");
    await window.keyboard.press("Escape");
  }

  await sleep(1000);
  await screenshot(window, "04-after-interrupt");

  // 7. Wait for session to return to idle (result entries are hidden — cost shown in header)
  log("Waiting for session to return to idle...");
  const idleAfterInterrupt = await waitForSelector(window, "#send:not([disabled])", 15000);
  log(`  Session idle (Send btn, not Stop): ${idleAfterInterrupt}`);
  await sleep(500);
  await screenshot(window, "05-result-after-interrupt");

  // 8. Check Stop button is gone (idle)
  const stopBtnGone = !(await window.locator("#stop-btn").isVisible({ timeout: 500 }).catch(() => false));
  log(`  Stop button gone (idle): ${stopBtnGone}`);

  // 9. Check session state via the rendered UI
  const inputEnabledAfter = await window.locator("#input:not([disabled])").isVisible().catch(() => false);
  log(`  Input enabled after interrupt: ${inputEnabledAfter}`);

  // 10. Send follow-up
  log("Sending follow-up message...");
  await inputEl.click();
  await inputEl.fill("Say exactly this and nothing else: INTERRUPT TEST PASSED");
  await sendEl.click();
  await sleep(500);

  // 11. Wait for follow-up to complete
  log("Waiting for follow-up response...");
  await sleep(15000);
  await screenshot(window, "06-followup-response");

  // Check if our marker text appears
  const pageText = await window.textContent("body");
  const hasMarker = pageText.includes("INTERRUPT TEST PASSED");
  log(`  Contains "INTERRUPT TEST PASSED": ${hasMarker}`);

  // ─── Test 2: Message Queue ─────────────────────────────────────
  log("");
  log("=== Test 2: Message Queue ===");

  // Send a long prompt to make Claude busy
  await inputEl.fill("Write a 300-word summary of the Apollo space program. Do not use any tools.");
  await sendEl.click();
  await sleep(1000);

  // Verify session is busy
  const busyAfterSend = await window.locator("#stop-btn").isVisible().catch(() => false);
  log(`  Session busy: ${busyAfterSend}`);

  // Input should still be enabled (always-active)
  const inputEnabledWhileBusy = !(await window.locator("#input").getAttribute("disabled"));
  log(`  Input enabled while busy: ${inputEnabledWhileBusy}`);

  // Type and send a queued message while busy
  await inputEl.fill("After that, say: QUEUE TEST PASSED");
  await sendEl.click();
  await sleep(500);
  await screenshot(window, "08-message-queued");

  // Check queue hint is visible
  const queueHintVisible = await window.locator(".queue-hint").isVisible().catch(() => false);
  log(`  Queue hint visible: ${queueHintVisible}`);

  // Wait for both turns to complete
  log("  Waiting for queued message to process...");
  await sleep(30000);
  await screenshot(window, "09-queue-flushed");

  const pageText2 = await window.textContent("body");
  const hasQueueMarker = pageText2.includes("QUEUE TEST PASSED");
  log(`  Contains "QUEUE TEST PASSED": ${hasQueueMarker}`);

  // ─── Test 3: Double-Escape ─────────────────────────────────────
  log("");
  log("=== Test 3: Double-Escape ===");

  await inputEl.fill("Count from 1 to 1000 slowly. Do not use tools.");
  await sendEl.click();
  await sleep(2000);

  // Single Escape → should show hint, NOT interrupt
  await inputEl.focus();
  await window.keyboard.press("Escape");
  await sleep(200);
  const hintVisible = await window.locator(".escape-hint").isVisible().catch(() => false);
  log(`  Escape hint after single Esc: ${hintVisible}`);
  await screenshot(window, "10-escape-hint");

  // Double Escape → should interrupt
  await window.keyboard.press("Escape");
  await window.keyboard.press("Escape");
  await sleep(100);
  await window.keyboard.press("Escape");
  await sleep(1000);
  const idleAfterDoubleEsc = await window.locator("#send:not([disabled])").isVisible().catch(() => false);
  log(`  Idle after double-Esc: ${idleAfterDoubleEsc}`);
  await screenshot(window, "11-double-escape-interrupted");

  // 12. Final screenshot
  await screenshot(window, "12-final");

  // ─── Summary ───────────────────────────────────────────────────
  log("");
  log("=== TEST SUMMARY ===");
  log(`  Session ready:         ${inputReady ? "PASS" : "FAIL"}`);
  log(`  Text generated:        ${textAppeared ? "PASS" : "FAIL"}`);
  log(`  Stop button visible:   ${stopBtnVisible ? "PASS" : "FAIL"}`);
  log(`  Idle after interrupt:  ${idleAfterInterrupt ? "PASS" : "FAIL"}`);
  log(`  Session stayed alive:  ${stopBtnGone && inputEnabledAfter ? "PASS" : "FAIL"}`);
  log(`  Follow-up worked:      ${hasMarker ? "PASS" : "FAIL"}`);
  log(`  Input while busy:      ${inputEnabledWhileBusy ? "PASS" : "FAIL"}`);
  log(`  Queue flushed:         ${hasQueueMarker ? "PASS" : "FAIL"}`);
  log(`  Escape hint:           ${hintVisible ? "PASS" : "FAIL"}`);
  log(`  Double-Esc interrupt:  ${idleAfterDoubleEsc ? "PASS" : "FAIL"}`);
  log("");

  const allPassed = inputReady && textAppeared && stopBtnVisible && idleAfterInterrupt && stopBtnGone && inputEnabledAfter && hasMarker
    && inputEnabledWhileBusy && hasQueueMarker && hintVisible && idleAfterDoubleEsc;
  log(allPassed ? "=== ALL TESTS PASSED ===" : "=== SOME TESTS FAILED ===");

  flushLog();
  await app.close();
  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  log(`FATAL: ${err}`);
  flushLog();
  process.exit(1);
});
