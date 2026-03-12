import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import type { SessionConfig } from "./schema.js";

// ─── Default claude path ────────────────────────────────────────

const DEFAULT_CLAUDE_PATH = process.platform === "win32"
  ? "claude.exe"
  : "claude";

// On Windows, resolve the real claude.exe path once at startup via `where`.
// The configured path may be a WinGet Links shim that cmd.exe can't execute.
let resolvedClaudePath: string | null = null;
if (process.platform === "win32") {
  try {
    resolvedClaudePath = execSync("where claude", { encoding: "utf-8", timeout: 3000 })
      .trim()
      .split(/\r?\n/)[0]
      .replace(/\//g, "\\") || null;
  } catch {}
}

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
    "--settings", settingsFilePath,
  ];

  if (config.model) args.push("--model", config.model);

  // Always bypass Claude's built-in permission prompts — they're designed
  // for interactive terminals and hang when stdio is piped.
  // We implement our own permission logic in the PreToolUse hook instead.
  args.push("--dangerously-skip-permissions");

  if (config.systemPrompt) args.push("--append-system-prompt", config.systemPrompt);
  if (config.resumeSessionId) args.push("--resume", config.resumeSessionId);
  if (config.maxTurns != null) args.push("--max-turns", String(config.maxTurns));
  if (config.maxBudgetUsd != null) args.push("--max-budget-usd", String(config.maxBudgetUsd));
  if (config.fallbackModel) args.push("--fallback-model", config.fallbackModel);
  if (config.effort) args.push("--effort", config.effort);
  if (config.worktree === true) args.push("--worktree");
  else if (typeof config.worktree === "string" && config.worktree) args.push("--worktree", config.worktree);
  if (config.noSessionPersistence) args.push("--no-session-persistence");

  for (const dir of config.addDirs ?? []) {
    args.push("--add-dir", dir);
  }

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
  // On Windows, prefer the resolved real path over the configured path
  // (which may be a WinGet Links shim that cmd.exe can't execute).
  let claudePath = resolvedClaudePath ?? config.claudePath ?? DEFAULT_CLAUDE_PATH;
  if (process.platform === "win32") {
    claudePath = claudePath.replace(/\//g, "\\");
  }

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
