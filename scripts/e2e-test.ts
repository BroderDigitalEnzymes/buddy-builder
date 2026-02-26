import { _electron as electron } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = process.env.TEMP ?? "/tmp";

async function run() {
  console.log("=== Launching Electron app ===");

  const app = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
  });

  const window = await app.firstWindow();
  console.log("=== Window opened ===");

  const logs: string[] = [];
  window.on("console", (msg) => {
    const line = `[console.${msg.type()}] ${msg.text()}`;
    logs.push(line);
    console.log(line);
  });
  window.on("pageerror", (err) => {
    const line = `[PAGE ERROR] ${err.message}`;
    logs.push(line);
    console.log(line);
  });

  await window.waitForLoadState("domcontentloaded");
  await new Promise((r) => setTimeout(r, 1000));

  // Screenshot 1: initial
  const ss1 = path.join(TEMP, "buddy-e2e-1-initial.png");
  await window.screenshot({ path: ss1 });
  console.log(`[SCREENSHOT] ${ss1}`);

  const hasNewSession = await window.isVisible("#new-session");
  const hasInput = await window.isVisible("#input");
  const hasSend = await window.isVisible("#send");
  console.log(`[DOM] newSession=${hasNewSession} input=${hasInput} send=${hasSend}`);

  // Create session
  console.log("=== Clicking + New ===");
  await window.click("#new-session");
  await new Promise((r) => setTimeout(r, 3000));

  const ss2 = path.join(TEMP, "buddy-e2e-2-session.png");
  await window.screenshot({ path: ss2 });
  console.log(`[SCREENSHOT] ${ss2}`);

  const tabCount = await window.locator(".tab").count();
  console.log(`[DOM] tabs=${tabCount}`);

  // Send a message
  console.log("=== Sending test message ===");
  const inputEl = window.locator("#input");
  const sendDisabled = await window.locator("#send").isDisabled();
  console.log(`[DOM] send disabled before typing=${sendDisabled}`);

  await inputEl.click();
  await inputEl.fill("Read package.json and tell me the project name.");
  const inputVal = await inputEl.inputValue();
  console.log(`[DOM] input value after fill="${inputVal}"`);

  // Debug: check send button state and try clicking
  const sendEl = window.locator("#send");
  const sendDisabled2 = await sendEl.isDisabled();
  const sendVisible = await sendEl.isVisible();
  console.log(`[DOM] send disabled=${sendDisabled2} visible=${sendVisible}`);

  // Try clicking the send button
  await sendEl.click();
  await new Promise((r) => setTimeout(r, 500));

  // Also check if the textarea still has value after click
  const inputValAfter = await inputEl.inputValue();
  console.log(`[DOM] input value after click send="${inputValAfter}"`);

  const msgCountAfterSend = await window.locator(".msg").count();
  console.log(`[DOM] messages immediately after send=${msgCountAfterSend}`);
  const htmlAfterSend = await window.locator("#messages").innerHTML().catch(() => "(no #messages)");
  console.log(`[DOM] HTML after send: ${htmlAfterSend.slice(0, 300)}`);

  // Wait for the response — poll for .msg-assistant or .msg-result
  console.log("=== Waiting for response ===");
  try {
    await window.locator(".msg-result").first().waitFor({ timeout: 30000 });
    console.log("[OK] Got result entry");
  } catch {
    console.log("[WARN] Timed out waiting for result, taking screenshot anyway");
  }

  await new Promise((r) => setTimeout(r, 500));

  const ss3 = path.join(TEMP, "buddy-e2e-3-response.png");
  await window.screenshot({ path: ss3 });
  console.log(`[SCREENSHOT] ${ss3}`);

  const msgCount = await window.locator(".msg").count();
  const toolCount = await window.locator(".tool-entry").count();
  const hasResult = await window.locator(".msg-result").count();
  const assistantText = await window.locator(".msg-assistant").first().textContent().catch(() => "(none)");
  console.log(`[DOM] messages=${msgCount} tools=${toolCount} results=${hasResult}`);
  console.log(`[DOM] assistant text: ${assistantText?.slice(0, 200)}`);

  // Test policy buttons
  console.log("=== Testing policy switch ===");
  const readOnlyBtn = window.locator('.policy-btn[data-preset="read-only"]');
  if (await readOnlyBtn.isVisible()) {
    await readOnlyBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    const ss4 = path.join(TEMP, "buddy-e2e-4-policy.png");
    await window.screenshot({ path: ss4 });
    console.log(`[SCREENSHOT] ${ss4}`);
  }

  // Error summary
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
