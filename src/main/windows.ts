import { BrowserWindow } from "electron";
import type { SessionEvent } from "../ipc.js";

// ─── Window Registry ─────────────────────────────────────────────

type WindowEntry =
  | { kind: "main"; win: BrowserWindow }
  | { kind: "popout"; win: BrowserWindow; sessionId: string };

const registry: WindowEntry[] = [];

export function register(entry: WindowEntry): void {
  registry.push(entry);
}

export function unregister(win: BrowserWindow): void {
  const idx = registry.findIndex((e) => e.win === win);
  if (idx >= 0) registry.splice(idx, 1);
}

/**
 * Dispatch a SessionEvent to all relevant windows.
 * Main window receives ALL events (sidebar needs full state).
 * Pop-out windows receive only events for their session.
 */
export function dispatch(event: SessionEvent): void {
  for (const entry of registry) {
    if (entry.win.isDestroyed()) continue;
    if (entry.kind === "main" || entry.sessionId === event.sessionId) {
      entry.win.webContents.send("sessionEvent", event);
    }
  }
}

export function findPopout(sessionId: string): BrowserWindow | null {
  const e = registry.find((e) => e.kind === "popout" && e.sessionId === sessionId);
  return e ? e.win : null;
}

export function getMain(): BrowserWindow | null {
  const e = registry.find((e) => e.kind === "main");
  return e ? e.win : null;
}

export function hasPopout(sessionId: string): boolean {
  return registry.some((e) => e.kind === "popout" && e.sessionId === sessionId);
}

/** Broadcast an event on a given channel to all registered windows. */
export function broadcast(channel: string, data: unknown): void {
  for (const entry of registry) {
    if (!entry.win.isDestroyed()) {
      entry.win.webContents.send(channel, data);
    }
  }
}

export function closeAllPopouts(): void {
  for (const entry of [...registry]) {
    if (entry.kind === "popout" && !entry.win.isDestroyed()) entry.win.close();
  }
}
