import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import {
  registerHandlers,
  createPushProxy,
  type Handlers,
  type Pushers,
} from "../ipc.js";
import { createSessionManager, type SessionManager } from "./manager.js";

const TEST_MODE = process.env.BUDDY_TEST === "1";

// Suppress GUI error dialogs — log to stderr instead
dialog.showErrorBox = (title: string, content: string) => {
  console.error(`[ERROR] ${title}: ${content}`);
};

let mainWindow: BrowserWindow | null = null;
let manager: SessionManager | null = null;
let push: Pushers | null = null;

// ─── Window ─────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "Buddy Builder",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Event pusher — routes to renderer via Proxy
  push = createPushProxy(
    (channel, data) => mainWindow?.webContents.send(channel, data),
  );

  mainWindow.on("closed", () => { mainWindow = null; push = null; });

  if (TEST_MODE) {
    mainWindow.webContents.on("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 1000));
      const logs = await mainWindow!.webContents.executeJavaScript(`
        JSON.stringify({
          sessionCount: document.querySelectorAll('.tab').length,
          messagesHTML: document.getElementById('messages')?.innerHTML?.slice(0, 500) ?? '',
          hasInput: !!document.getElementById('input'),
          hasSendBtn: !!document.getElementById('send'),
          hasNewSession: !!document.getElementById('new-session'),
          hasToolbar: !!document.getElementById('toolbar'),
          hasPolicyBtns: document.querySelectorAll('.policy-btn').length,
        })
      `);
      console.log("[TEST:DOM]", logs);
      const image = await mainWindow!.webContents.capturePage();
      const p = path.join(process.env.TEMP ?? "/tmp", "buddy-screenshot.png");
      fs.writeFileSync(p, image.toPNG());
      console.log(`[TEST:SCREENSHOT] ${p}`);
      app.quit();
    });
  }
}

// ─── IPC — one handler object, one registration call ────────────

function setupIpc(mgr: SessionManager): void {
  const handlers: Handlers = {
    createSession: (opts) => mgr.create(opts),
    sendMessage:   ({ sessionId, text }) => { mgr.send(sessionId, text); },
    killSession:   ({ sessionId }) => { mgr.kill(sessionId); },
    listSessions:  () => mgr.list(),
    updatePolicy:  ({ sessionId, policy }) => { mgr.updatePolicy(sessionId, policy); },
    getPolicy:     ({ sessionId }) => mgr.getPolicy(sessionId),
  };

  registerHandlers(
    (ch, fn) => ipcMain.handle(ch, fn as any),
    handlers,
  );
}

// ─── App lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  manager = createSessionManager((event) => push?.sessionEvent(event));
  setupIpc(manager);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await manager?.dispose();
  app.quit();
});
