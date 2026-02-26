import { spawn, type ChildProcess } from "child_process";
import type { SessionConfig } from "./schema.js";

// ─── Default claude path ────────────────────────────────────────

const DEFAULT_CLAUDE_PATH = process.platform === "win32"
  ? "claude.exe"
  : "claude";

// ─── Arg builder ────────────────────────────────────────────────

export function buildArgs(
  config: SessionConfig,
  settingsJson: string,
): string[] {
  const args: string[] = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--settings", settingsJson,
  ];

  if (config.model) args.push("--model", config.model);
  if (config.systemPrompt) args.push("--system-prompt", config.systemPrompt);
  if (config.appendSystemPrompt) args.push("--append-system-prompt", config.appendSystemPrompt);
  if (config.permissionMode) args.push("--permission-mode", config.permissionMode);
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
  const args = buildArgs(config, settingsJson);

  return spawn(claudePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: config.cwd,
    env: {
      ...process.env,
      ...config.env,
      CLAUDECODE: "",             // prevent nested session guard
      BUDDY_PORT: String(hookPort),
    },
  });
}
