import * as os from "os";
import * as path from "path";
import { readFileSync, readdirSync, statSync } from "fs";
import type { ChatEntry } from "../ipc.js";
import { summarizeInput, truncateResult } from "../entry-builder.js";

// ─── Types ──────────────────────────────────────────────────────

export type SessionStub = {
  claudeSessionId: string;
  transcriptPath: string;
  projectName: string;
  cwd: string | null;
  firstPrompt: string;
  slug: string;
  createdAt: number;
  lastActiveAt: number;
};

// ─── Path helpers ───────────────────────────────────────────────

export function claudeProjectDir(cwd: string): string {
  const encoded = cwd.replace(/[:/\\]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Decode an encoded project directory name into a readable project name.
 * e.g. "C--eran-projects-heal-ai" → "heal-ai"
 *      "C--t-buddy-builder"       → "buddy-builder"
 */
function decodeProjectName(encoded: string): string {
  // The encoding replaced :/\ with "-", so "-Users-tom-code-foo" was "/Users/tom/code/foo".
  // Reverse: replace leading "-" with "/" and remaining "-" with "/".
  return "/" + encoded.replace(/^-/, "").replace(/-/g, "/");
}

// ─── Discovery ──────────────────────────────────────────────────

/**
 * Scan ALL Claude project directories for JSONL transcripts.
 * Returns stubs from every project, sorted by lastActiveAt.
 */
export function discoverAllSessions(): SessionStub[] {
  const root = claudeProjectsRoot();
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }

  const allStubs: SessionStub[] = [];
  for (const dir of dirs) {
    const fullPath = path.join(root, dir);
    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const projectName = decodeProjectName(dir);
    allStubs.push(...discoverSessions(fullPath, projectName));
  }

  return allStubs.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/**
 * Scan a Claude project directory for JSONL transcript files.
 * Returns lightweight stubs without parsing full entries.
 */
export function discoverSessions(projectDir: string, projectName?: string): SessionStub[] {
  let files: string[];
  try {
    files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return []; // directory doesn't exist yet
  }

  const stubs: SessionStub[] = [];

  for (const file of files) {
    const filePath = path.join(projectDir, file);

    // Skip subdirectories (sub-agent files live in dirs)
    try {
      if (statSync(filePath).isDirectory()) continue;
    } catch {
      continue;
    }

    try {
      const stub = extractStub(filePath, projectName ?? path.basename(projectDir));
      if (stub) stubs.push(stub);
    } catch {
      // skip corrupt files
    }
  }

  return stubs.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/**
 * Read first N lines + last line from a JSONL file to extract metadata.
 */
function extractStub(filePath: string, projectName: string): SessionStub | null {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let firstPrompt = "";
  let slug = "";
  let createdAt = 0;
  let lastActiveAt = 0;

  // Scan first 30 lines for metadata
  const headLines = lines.slice(0, 30);
  for (const line of headLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.sessionId && !sessionId) sessionId = obj.sessionId;
      if (obj.cwd && !cwd) cwd = obj.cwd;
      if (obj.slug && !slug) slug = obj.slug;
      if (obj.timestamp && !createdAt) createdAt = new Date(obj.timestamp).getTime();

      // First user text message → firstPrompt
      if (!firstPrompt && obj.type === "user" && obj.message?.content) {
        const text = extractUserText(obj.message.content);
        if (text) firstPrompt = text.slice(0, 120);
      }
    } catch { /* skip unparseable lines */ }
  }

  // Last line → lastActiveAt
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    if (last.timestamp) lastActiveAt = new Date(last.timestamp).getTime();
  } catch { /* use createdAt */ }

  if (!sessionId) return null;

  return {
    claudeSessionId: sessionId,
    transcriptPath: filePath,
    projectName,
    cwd,
    firstPrompt: firstPrompt || "(empty session)",
    slug,
    createdAt: createdAt || Date.now(),
    lastActiveAt: lastActiveAt || createdAt || Date.now(),
  };
}

// ─── Parsing ────────────────────────────────────────────────────

/**
 * Parse a full JSONL transcript file into ChatEntry[].
 */
export function parseTranscript(filePath: string): ChatEntry[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = raw.split("\n");
  const entries: ChatEntry[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();

    // Skip non-message types
    if (obj.type === "queue-operation" || obj.type === "progress" || obj.type === "file-history-snapshot") {
      continue;
    }
    if (obj.type === "system") {
      continue;
    }

    // User messages
    if (obj.type === "user" && obj.message?.role === "user") {
      const content = obj.message.content;

      // Check if this is a tool_result message
      if (Array.isArray(content) && content.length > 0 && content[0]?.type === "tool_result") {
        // Apply tool results to matching tool entries
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const toolEntry = findToolByUseId(entries, block.tool_use_id);
          if (toolEntry) {
            toolEntry.status = "done";
            toolEntry.toolResult = truncateResult(block.content);
          }
        }
        continue;
      }

      // Regular user text message
      const text = extractUserText(content);
      if (text) {
        entries.push({ kind: "user", text, ts });
      }
      continue;
    }

    // Assistant messages
    if (obj.type === "assistant" && obj.message?.role === "assistant") {
      const content = obj.message.content;
      if (!Array.isArray(content)) continue;

      // Collect text blocks
      const textParts: string[] = [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          // Push a tool entry
          entries.push({
            kind: "tool",
            toolName: block.name,
            toolUseId: block.id,
            status: "running",
            detail: summarizeInput(block.input ?? {}),
            toolInput: block.input ?? {},
            ts,
          });
        }
        // Skip thinking, server_tool_use, etc.
      }

      if (textParts.length > 0) {
        entries.push({ kind: "text", text: textParts.join(""), ts });
      }
      continue;
    }
  }

  // Finalize: mark any still-"running" tools as "done" (transcript is complete)
  for (const entry of entries) {
    if (entry.kind === "tool" && entry.status === "running") {
      entry.status = "done";
    }
  }

  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n");
  }
  return "";
}

function findToolByUseId(entries: ChatEntry[], toolUseId: string): (ChatEntry & { kind: "tool" }) | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "tool" && e.toolUseId === toolUseId) return e;
  }
  return undefined;
}
