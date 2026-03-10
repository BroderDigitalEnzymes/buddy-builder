import { _electron as electron } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log("Launching app...");

  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
    env: { ...process.env, BUDDY_TEST: "0" },
  });

  // Capture main process stdout/stderr
  const proc = eApp.process();
  proc.stdout?.on("data", (d: Buffer) => process.stdout.write("[main:out] " + d.toString()));
  proc.stderr?.on("data", (d: Buffer) => process.stdout.write("[main:err] " + d.toString()));

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n=== Window count ===");
  const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log("Windows:", wc);

  // Close all windows and wait
  console.log("\n=== Closing all windows ===");
  await eApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
  await new Promise((r) => setTimeout(r, 3000));

  // Check if alive
  try {
    const wc2 = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    console.log("After close-all, windows:", wc2, "- APP IS ALIVE");
  } catch (err) {
    console.log("After close-all - APP DIED:", String(err).slice(0, 200));
  }

  // Quit
  try {
    await eApp.evaluate(({ app }) => app.quit());
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
  try { await eApp.close(); } catch {}
  console.log("Done.");
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
