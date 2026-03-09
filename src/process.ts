import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { SessionConfig } from "./schema.js";

// ─── Default claude path ────────────────────────────────────────

const DEFAULT_CLAUDE_PATH = process.platform === "win32"
  ? "claude.exe"
  : "claude";

// ─── Arg builder ────────────────────────────────────────────────

export function buildArgs(
  config: SessionConfig,
  settingsFilePath: string,
): string[] {
  const args: string[] = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--settings", settingsFilePath,
  ];

  if (config.model) args.push("--model", config.model);

  // Always bypass Claude's built-in permission prompts — they're designed
  // for interactive terminals and hang when stdio is piped.
  // We implement our own permission logic in the PreToolUse hook instead.
  args.push("--dangerously-skip-permissions");

  if (config.resumeSessionId) args.push("--resume", config.resumeSessionId);
  if (config.maxTurns != null) args.push("--max-turns", String(config.maxTurns));
  if (config.noSessionPersistence) args.push("--no-session-persistence");

  for (const tool of config.allowedTools ?? []) {
    args.push("--allowedTools", tool);
  }
  for (const tool of config.disallowedTools ?? []) {
    args.push("--disallowedTools", tool);
  }

  return args;
}

// ─── Spawn ──────────────────────────────────────────────────────

export function spawnClaude(
  config: SessionConfig,
  hookPort: number,
  settingsJson: string,
): ChildProcess {
  const claudePath = config.claudePath ?? DEFAULT_CLAUDE_PATH;

  // Write settings to a temp file to avoid shell escaping issues on Windows
  const settingsDir = join(tmpdir(), "buddy-builder");
  mkdirSync(settingsDir, { recursive: true });
  const settingsFile = join(settingsDir, `settings-${randomUUID()}.json`);
  writeFileSync(settingsFile, settingsJson, "utf-8");

  const args = buildArgs(config, settingsFile);

  console.log("[spawn]", claudePath, args.join(" "));
  console.log("[spawn cwd]", config.cwd ?? "(inherit)");

  const child = spawn(claudePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: config.cwd,
    shell: process.platform === "win32",  // .cmd files need shell on Windows
    env: {
      ...process.env,
      ...config.env,
      CLAUDECODE: "",             // prevent nested session guard
      BUDDY_PORT: String(hookPort),
    },
  });

  // Clean up temp file when process exits
  child.on("exit", () => {
    try { unlinkSync(settingsFile); } catch {}
  });

  return child;
}
