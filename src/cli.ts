import * as readline from "readline";
import { createSession, type Session } from "./index.js";

// ─── Colors (ANSI) ──────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ─── Display helpers ────────────────────────────────────────────

function showHelp(): void {
  console.log(`
${cyan("Commands:")}
  .state     Show session state
  .cost      Show total cost
  .policy    Toggle blocking Write/Edit tools
  .stop      Interrupt current turn (soft)
  .kill      Kill the session
  .quit      Exit
  .help      This message
`);
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(dim("Starting session..."));

  const session: Session = await createSession({
    permissionMode: "bypassPermissions",
  });

  let blockWrites = false;

  session.setToolPolicy((toolName, _input) => {
    if (blockWrites && (toolName === "Write" || toolName === "Edit")) {
      return { action: "block", reason: "Write/Edit blocked by CLI policy" };
    }
    return { action: "allow" };
  });

  session.on("ready", (init) => {
    console.log(green(`Ready`) + dim(` session=${init.session_id.slice(0, 8)} model=${init.model}`));
  });

  session.on("text", (ev) => {
    process.stdout.write(ev.text);
  });

  session.on("toolStart", (ev) => {
    const inputSummary = Object.entries(ev.toolInput)
      .map(([k, v]) => `${k}=${typeof v === "string" ? shortPath(v) : JSON.stringify(v)}`)
      .join(" ");
    console.log(cyan(`  [${ev.toolName}]`) + dim(` ${inputSummary}`));
  });

  session.on("toolEnd", (ev) => {
    console.log(cyan(`  [${ev.toolName} ✓]`));
  });

  session.on("toolBlocked", (ev) => {
    console.log(red(`  [${ev.toolName} BLOCKED]`) + dim(` ${ev.reason}`));
  });

  session.on("result", (result) => {
    console.log();
    console.log(
      dim(`─── $${result.total_cost_usd.toFixed(4)} · ${result.num_turns} turns · ${(result.duration_ms / 1000).toFixed(1)}s ───`),
    );
    rl.prompt();
  });

  session.on("error", (err) => {
    console.log(red(`Error: ${err.message}`));
  });

  session.on("warn", (msg) => {
    console.log(yellow(`warn: ${msg.slice(0, 120)}`));
  });

  session.on("exit", (ev) => {
    console.log(dim(`Process exited code=${ev.code} signal=${ev.signal}`));
    rl.close();
    process.exit(0);
  });

  // ── Readline ──
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.on("line", (input) => {
    const trimmed = input.trim();
    if (!trimmed) { rl.prompt(); return; }

    // ── Commands ──
    if (trimmed.startsWith(".")) {
      switch (trimmed) {
        case ".quit":
        case ".exit":
          session.dispose().then(() => process.exit(0));
          return;
        case ".stop":
          if (session.state !== "busy") {
            console.log(dim("Not busy — nothing to interrupt."));
          } else {
            console.log(yellow("Interrupting..."));
            session.interrupt();
          }
          rl.prompt();
          return;
        case ".kill":
          session.kill();
          rl.prompt();
          return;
        case ".state":
          console.log(`state=${session.state} session=${session.sessionId ?? "none"}`);
          rl.prompt();
          return;
        case ".cost":
          console.log(`total=$${session.totalCost.toFixed(4)}`);
          rl.prompt();
          return;
        case ".policy":
          blockWrites = !blockWrites;
          console.log(`Write/Edit blocking: ${blockWrites ? red("ON") : green("OFF")}`);
          rl.prompt();
          return;
        case ".help":
          showHelp();
          rl.prompt();
          return;
        default:
          console.log(dim(`Unknown command: ${trimmed}. Type .help`));
          rl.prompt();
          return;
      }
    }

    // ── Send to Claude ──
    try {
      session.send(trimmed);
    } catch (err) {
      console.log(red(err instanceof Error ? err.message : String(err)));
      rl.prompt();
    }
  });

  rl.on("close", () => {
    session.dispose().then(() => process.exit(0));
  });

  showHelp();
  rl.prompt();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
