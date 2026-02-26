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

  // Collect all console messages
  const logs: string[] = [];
  window.on("console", (msg) => {
    const line = `[console.${msg.type()}] ${msg.text()}`;
    logs.push(line);
    console.log(line);
  });

  // Collect page errors
  window.on("pageerror", (err) => {
    const line = `[PAGE ERROR] ${err.message}`;
    logs.push(line);
    console.log(line);
  });

  // Wait for page to load
  await window.waitForLoadState("domcontentloaded");
  await new Promise((r) => setTimeout(r, 1000));

  // Screenshot: initial state
  const ss1 = path.join(TEMP, "buddy-e2e-1-initial.png");
  await window.screenshot({ path: ss1 });
  console.log(`[SCREENSHOT] ${ss1}`);

  // Check DOM elements
  const hasNewSession = await window.isVisible("#new-session");
  const hasInput = await window.isVisible("#input");
  const hasSend = await window.isVisible("#send");
  const hasToolbar = await window.isVisible("#toolbar");
  const tabCount = await window.locator(".tab").count();
  const policyBtnCount = await window.locator(".policy-btn").count();

  console.log(`[DOM] newSession=${hasNewSession} input=${hasInput} send=${hasSend} toolbar=${hasToolbar} tabs=${tabCount} policyBtns=${policyBtnCount}`);

  // Try creating a session
  console.log("=== Clicking + New ===");
  await window.click("#new-session");
  await new Promise((r) => setTimeout(r, 3000)); // wait for session to spawn

  // Screenshot: after session creation
  const ss2 = path.join(TEMP, "buddy-e2e-2-session.png");
  await window.screenshot({ path: ss2 });
  console.log(`[SCREENSHOT] ${ss2}`);

  const tabCount2 = await window.locator(".tab").count();
  const messagesHTML = await window.locator("#messages").innerHTML();
  console.log(`[DOM] tabs after create=${tabCount2}`);
  console.log(`[DOM] messages HTML (first 500): ${messagesHTML.slice(0, 500)}`);

  // Check if send button is enabled (session should be idle)
  const sendDisabled = await window.locator("#send").isDisabled();
  console.log(`[DOM] send disabled=${sendDisabled}`);

  // Try sending a message if session is ready
  if (!sendDisabled) {
    console.log("=== Sending test message ===");
    await window.fill("#input", "Say hello in exactly 5 words.");
    await window.click("#send");
    await new Promise((r) => setTimeout(r, 8000)); // wait for response

    const ss3 = path.join(TEMP, "buddy-e2e-3-response.png");
    await window.screenshot({ path: ss3 });
    console.log(`[SCREENSHOT] ${ss3}`);

    const messagesAfter = await window.locator("#messages").innerHTML();
    console.log(`[DOM] messages after send (first 800): ${messagesAfter.slice(0, 800)}`);
  }

  // Final summary
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
