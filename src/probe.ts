/**
 * probe.ts — Persistent backend test harness for buddy-builder SDK.
 *
 * Usage:
 *   npx tsx src/probe.ts [--mode bypassPermissions]
 *
 * Reads commands from stdin (line-buffered). Logs all events to stdout.
 * When run interactively: type prompts, see events.
 * When run from automation: pipe commands in, read output.
 *
 * Special commands:
 *   .send <text>    Send a message (or just type text directly)
 *   .state          Print session state
 *   .cost           Print total cost
 *   .kill           Kill the session
 *   .quit           Exit
 *   .answer <id> <text>  Answer a pending question
 */

import * as readline from "readline";
import { createSession, type Session } from "./index.js";

// ─── CLI arg parsing ────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const MODE = getArg("mode", "bypassPermissions") as "default" | "plan" | "acceptEdits" | "bypassPermissions";

// ─── Logging (always flush, timestamp) ──────────────────────────

function log(tag: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("PROBE", `Starting session mode=${MODE}`);

  const session: Session = await createSession({
    permissionMode: MODE,
  });

  log("PROBE", "Session created, wiring events...");

  // ── Events ──
  session.on("ready", (init) => {
    log("READY", `session=${init.session_id.slice(0, 8)} model=${init.model} tools=${init.tools.length}`);
  });

  session.on("stateChange", (ev) => {
    log("STATE", `${ev.from} → ${ev.to}`);
  });

  session.on("text", (text) => {
    // Print text inline, no tag (for readability)
    process.stdout.write(text);
  });

  session.on("toolStart", (ev) => {
    const input = JSON.stringify(ev.toolInput).slice(0, 300);
    log("TOOL+", `${ev.toolName} id=${ev.toolUseId.slice(0, 8)} input=${input}`);
  });

  session.on("toolEnd", (ev) => {
    const resp = typeof ev.response === "string"
      ? ev.response.slice(0, 300)
      : JSON.stringify(ev.response).slice(0, 300);
    log("TOOL✓", `${ev.toolName} id=${ev.toolUseId.slice(0, 8)} response=${resp}`);
  });

  session.on("toolBlocked", (ev) => {
    log("BLOCK", `${ev.toolName} reason=${ev.reason}`);
  });

  session.on("result", (result) => {
    log("RESULT", `$${result.total_cost_usd.toFixed(4)} · ${result.num_turns} turns · ${(result.duration_ms / 1000).toFixed(1)}s`);
  });

  session.on("error", (err) => {
    log("ERROR", err.message);
  });

  session.on("warn", (msg) => {
    log("WARN", msg.slice(0, 300));
  });

  session.on("exit", (ev) => {
    log("EXIT", `code=${ev.code} signal=${ev.signal}`);
    rl.close();
    process.exit(0);
  });

  // ── Interactive readline ──
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "probe> ",
    terminal: process.stdin.isTTY ?? false,
  });

  function promptIfIdle(): void {
    if (session.state === "idle" || session.state === "dead") {
      rl.prompt();
    }
  }

  session.on("result", () => {
    console.log(); // newline after result
    promptIfIdle();
  });

  rl.on("line", (input) => {
    const trimmed = input.trim();
    if (!trimmed) { promptIfIdle(); return; }

    // ── Dot-commands ──
    if (trimmed.startsWith(".")) {
      const [cmd, ...rest] = trimmed.split(/\s+/);
      switch (cmd) {
        case ".quit":
        case ".exit":
          session.dispose().then(() => process.exit(0));
          return;
        case ".kill":
          session.kill();
          log("CMD", "Session killed");
          promptIfIdle();
          return;
        case ".state":
          log("CMD", `state=${session.state} session=${session.sessionId ?? "none"}`);
          promptIfIdle();
          return;
        case ".cost":
          log("CMD", `total=$${session.totalCost.toFixed(4)}`);
          promptIfIdle();
          return;
        case ".answer": {
          const id = rest[0];
          const answer = rest.slice(1).join(" ");
          if (!id || !answer) {
            log("CMD", "Usage: .answer <toolUseId-prefix> <answer text>");
          } else {
            session.answerQuestion(id, answer);
            log("CMD", `Answered ${id}: "${answer}"`);
          }
          promptIfIdle();
          return;
        }
        case ".send":
          // .send is explicit send — rest is the message
          if (rest.length === 0) {
            log("CMD", "Usage: .send <message>");
            promptIfIdle();
            return;
          }
          try {
            session.send(rest.join(" "));
            log("SEND", rest.join(" "));
          } catch (err) {
            log("ERROR", err instanceof Error ? err.message : String(err));
            promptIfIdle();
          }
          return;
        default:
          log("CMD", `Unknown command: ${cmd}`);
          promptIfIdle();
          return;
      }
    }

    // ── Regular text = send as message ──
    try {
      session.send(trimmed);
      log("SEND", trimmed);
    } catch (err) {
      log("ERROR", err instanceof Error ? err.message : String(err));
      promptIfIdle();
    }
  });

  rl.on("close", () => {
    session.dispose().then(() => process.exit(0));
  });

  log("PROBE", "Ready. Type a message or .help");
  promptIfIdle();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
