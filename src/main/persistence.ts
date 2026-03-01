import { app } from "electron";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import type { PersistedSession } from "../ipc.js";

function sessionsDir(): string {
  const dir = join(app.getPath("userData"), "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(id: string): string {
  return join(sessionsDir(), `${id}.json`);
}

export function saveSession(data: PersistedSession): void {
  try {
    writeFileSync(sessionPath(data.id), JSON.stringify(data), "utf-8");
  } catch (err) {
    console.error(`[persistence] Failed to save session ${data.id}:`, err);
  }
}

export function loadSession(id: string): PersistedSession | null {
  try {
    const raw = readFileSync(sessionPath(id), "utf-8");
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function loadAllSessions(): PersistedSession[] {
  const dir = sessionsDir();
  const results: PersistedSession[] = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        results.push(JSON.parse(raw) as PersistedSession);
      } catch {
        // skip corrupt files
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return results;
}

export function deleteSessionFile(id: string): void {
  try {
    unlinkSync(sessionPath(id));
  } catch {
    // already gone
  }
}
