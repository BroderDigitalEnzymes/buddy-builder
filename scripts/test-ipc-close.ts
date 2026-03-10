import { _electron as electron } from "playwright";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log("Launching app...");
  const eApp = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main.cjs")],
  });

  eApp.process().stdout?.on("data", (d: Buffer) => process.stdout.write("[main] " + d.toString()));

  const page = await eApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await new Promise(r => setTimeout(r, 2000));

  console.log("\n=== Clicking custom X button (winClose IPC) ===");
  try {
    await page.evaluate(() => {
      (window as any).claude.winClose();
    });
    console.log("winClose IPC sent");
  } catch (err) {
    console.log("winClose call result:", String(err).slice(0, 100));
  }

  await new Promise(r => setTimeout(r, 3000));

  try {
    const wc = await eApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    console.log(`After IPC winClose: windows=${wc}, APP IS ALIVE`);
  } catch (err) {
    console.log(`After IPC winClose: APP DIED — ${String(err).slice(0, 150)}`);
  }

  try { await eApp.evaluate(({ app }) => app.quit()); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  try { await eApp.close(); } catch {}
  console.log("Done.");
}

run().catch(err => { console.error(err); process.exit(1); });
