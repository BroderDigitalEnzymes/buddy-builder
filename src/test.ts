import { createSession } from "./index.js";

async function main() {
  console.log("Creating session...");

  const session = await createSession();

  // Log all events
  session.on("ready", (init) =>
    console.log(`[ready] session=${init.session_id.slice(0, 8)} model=${init.model} tools=${init.tools.length}`));
  session.on("stateChange", (ev) =>
    console.log(`[state] ${ev.from} → ${ev.to}`));
  session.on("text", (text) =>
    console.log(`[text] "${text}"`));
  session.on("toolStart", (ev) =>
    console.log(`[tool:start] ${ev.toolName} ${JSON.stringify(ev.toolInput).slice(0, 80)}`));
  session.on("toolEnd", (ev) =>
    console.log(`[tool:end] ${ev.toolName}`));
  session.on("result", (r) =>
    console.log(`[result] "${(r.result ?? "").slice(0, 60)}" cost=$${r.total_cost_usd.toFixed(4)} turns=${r.num_turns}`));
  session.on("stop", (ev) =>
    console.log(`[stop] hookActive=${ev.stopHookActive}`));
  session.on("error", (err) =>
    console.log(`[error] ${err.message.slice(0, 80)}`));
  session.on("warn", (msg) =>
    console.log(`[warn] ${msg.slice(0, 80)}`));

  // Turn 1: simple text
  console.log("\n--- Turn 1: simple text ---");
  const r1 = await session.prompt("say exactly: pong");
  console.log(`state=${session.state} sessionId=${session.sessionId?.slice(0, 8)}`);

  // Turn 2: trigger a tool use
  console.log("\n--- Turn 2: tool use ---");
  const r2 = await session.prompt("read the file package.json and tell me only the project name");
  console.log(`state=${session.state} cost=$${session.totalCost.toFixed(4)}`);

  // Turn 3: multi-turn memory
  console.log("\n--- Turn 3: memory check ---");
  const r3 = await session.prompt("what was the project name you just told me? reply with just the name");
  console.log(`state=${session.state}`);

  // Cleanup
  console.log("\n--- Done ---");
  await session.dispose();
  console.log("Disposed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
