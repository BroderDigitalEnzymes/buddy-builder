import { spawn } from "child_process";
import { createServer, type Server } from "http";

// ─── Hook event receiver ───────────────────────────────────────────
// Tiny HTTP server that hooks POST events to

function startHookServer(): Promise<{ server: Server; port: number; events: any[] }> {
  return new Promise((resolve) => {
    const events: any[] = [];
    const server = createServer((req, res) => {
      const hookName = req.headers["x-hook"] ?? "unknown";
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let toolName = "-";
        try {
          const data = JSON.parse(body);
          toolName = data.tool_name ?? "-";
          events.push({ ts: Date.now(), hook: hookName, data });
          const input = data.tool_input ? JSON.stringify(data.tool_input).slice(0, 120) : "-";
          console.log(`[HOOK:${hookName}] tool=${toolName} input=${input}`);
          console.log(`  keys: ${Object.keys(data).join(", ")}`);
        } catch {
          console.log(`[HOOK:${hookName} RAW] ${body.slice(0, 300)}`);
        }
        // Test: block Write/Edit tools via PreToolUse
        let response = "ok";
        if (hookName === "PreToolUse" && (toolName === "Write" || toolName === "Edit")) {
          response = "block";
          console.log(`  >>> BLOCKING ${toolName}!`);
        }
        res.writeHead(200);
        res.end(response);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      console.log(`[HOOK SERVER] listening on port ${port}`);
      resolve({ server, port, events });
    });
  });
}

// ─── Hook scripts ──────────────────────────────────────────────────
// Inline bash scripts that hooks execute — they POST to our server

// Send the FULL hook input as POST body — we want to see everything
// For PreToolUse: server responds with "block" or "allow" — we use the exit code
const hookScript = (hookName: string) =>
  `bash -c 'INPUT=$(cat); RESP=$(curl -s -X POST http://127.0.0.1:$BUDDY_PORT -H "X-Hook: ${hookName}" -d "$INPUT" 2>/dev/null); if [ "$RESP" = "block" ]; then echo "Blocked by buddy-builder" >&2; exit 2; fi; exit 0'`;

// ─── Settings with hooks ───────────────────────────────────────────

function buildSettings(port: number) {
  return {
    hooks: {
      PreToolUse: [{
        matcher: "",
        hooks: [{ type: "command", command: hookScript("PreToolUse") }],
      }],
      PostToolUse: [{
        matcher: "",
        hooks: [{ type: "command", command: hookScript("PostToolUse") }],
      }],
      Stop: [{
        matcher: "",
        hooks: [{ type: "command", command: hookScript("Stop") }],
      }],
      Notification: [{
        matcher: "",
        hooks: [{ type: "command", command: hookScript("Notification") }],
      }],
    },
  };
}

// ─── stdout NDJSON parser ──────────────────────────────────────────

function parseStdout(data: Buffer) {
  const text = data.toString();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      switch (msg.type) {
        case "system":
          console.log(`[OUT] system:${msg.subtype} session=${msg.session_id?.slice(0, 8)} model=${msg.model}`);
          break;
        case "assistant": {
          const blocks = msg.message?.content ?? [];
          for (const b of blocks) {
            if (b.type === "text") console.log(`[OUT] text: "${b.text.slice(0, 100)}"`);
            if (b.type === "tool_use") console.log(`[OUT] tool_use: ${b.name} input_keys=${Object.keys(b.input ?? {})}`);
            if (b.type === "tool_result") console.log(`[OUT] tool_result: ${b.tool_use_id?.slice(0, 8)}`);
          }
          break;
        }
        case "result":
          console.log(`[OUT] result:${msg.subtype} "${msg.result?.slice(0, 80)}" cost=$${msg.total_cost_usd} turns=${msg.num_turns}`);
          break;
        default:
          console.log(`[OUT] ${msg.type}: ${JSON.stringify(msg).slice(0, 120)}`);
      }
    } catch {
      console.log(`[OUT RAW] ${line.slice(0, 120)}`);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const { server, port, events } = await startHookServer();
  console.log(`\n=== PROBE: hooks + stream-json ===\n`);

  const settings = buildSettings(port);
  const claudePath = String.raw`C:\Users\eran\.local\bin\claude.exe`;

  const claude = spawn(claudePath, [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--settings", JSON.stringify(settings),
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: "", BUDDY_PORT: String(port) },
  });

  console.log(`[PROC] pid=${claude.pid}\n`);

  claude.stdout.on("data", parseStdout);
  claude.stderr.on("data", (d: Buffer) => console.log(`[ERR] ${d.toString().trim()}`));
  claude.on("exit", (code) => {
    console.log(`\n[PROC] exited code=${code}`);
    console.log(`\n=== HOOK EVENTS LOG (${events.length}) ===`);
    for (const e of events) console.log(` ${e.hook} | tool=${e.tool || "-"} | ${JSON.stringify(e.data).slice(0, 100)}`);
    server.close();
  });

  // Helper
  function send(text: string) {
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    console.log(`\n[SEND] "${text}"\n`);
    claude.stdin.write(msg + "\n");
  }

  // Turn 1: Force a tool use — Read (should be allowed)
  setTimeout(() => send("read package.json and tell me the project name. be brief."), 1500);

  // Turn 2: Try a Write (should be BLOCKED by our hook)
  setTimeout(() => send("create a file called /tmp/test-buddy.txt containing 'hello'. use the Write tool."), 15000);

  // Cleanup
  setTimeout(() => {
    console.log("\n[TIMEOUT] killing");
    claude.kill();
    setTimeout(() => process.exit(0), 1000);
  }, 30000);
}

main();
