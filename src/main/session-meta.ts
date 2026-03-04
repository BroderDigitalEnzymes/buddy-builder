import { app } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { PermissionMode, PolicyPreset } from "../ipc.js";

// ─── Types ──────────────────────────────────────────────────────

export type SessionMeta = {
  name?: string;
  favorite?: boolean;
  permissionMode?: PermissionMode;
  policyPreset?: PolicyPreset;
};

export type MetaStore = Record<string, SessionMeta>;

// ─── Disk path ──────────────────────────────────────────────────

function metaPath(): string {
  return join(app.getPath("userData"), "session-meta.json");
}

// ─── CRUD ───────────────────────────────────────────────────────

export function loadMeta(): MetaStore {
  try {
    const raw = readFileSync(metaPath(), "utf-8");
    return JSON.parse(raw) as MetaStore;
  } catch {
    return {};
  }
}

export function saveMeta(meta: MetaStore): void {
  try {
    writeFileSync(metaPath(), JSON.stringify(meta, null, 2), "utf-8");
  } catch (err) {
    console.error("[session-meta] Failed to save:", err);
  }
}

export function updateSessionMeta(id: string, patch: Partial<SessionMeta>): void {
  const meta = loadMeta();
  meta[id] = { ...meta[id], ...patch };
  saveMeta(meta);
}

export function deleteSessionMeta(id: string): void {
  const meta = loadMeta();
  delete meta[id];
  saveMeta(meta);
}
