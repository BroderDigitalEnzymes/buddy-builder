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
import { loadConfig, saveConfig } from "./config.js";

// ─── Constants ───────────────────────────────────────────────────

const TEST_MODE = process.env.BUDDY_TEST === "1";

/** Matches --bg-0 in styles.css so there's no white flash on launch. */
const BG_COLOR = "#1a1d21";

const INITIAL_WIDTH = 1060;
const INITIAL_HEIGHT = 740;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

// ─── Globals ─────────────────────────────────────────────────────

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
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: BG_COLOR,
    title: "Buddy Builder",
    icon: path.join(__dirname, "assets", "icon-256.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  push = createPushProxy(
    (channel, data) => mainWindow?.webContents.send(channel, data),
  );

  mainWindow.on("closed", () => { mainWindow = null; push = null; });

  if (TEST_MODE) runTestMode();
}

function runTestMode(): void {
  mainWindow!.webContents.on("did-finish-load", async () => {
    await new Promise((r) => setTimeout(r, 1000));
    const logs = await mainWindow!.webContents.executeJavaScript(`
      JSON.stringify({
        sessionCount: document.querySelectorAll('.session-item').length,
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

// ─── IPC — one handler object, one registration call ────────────

function setupIpc(mgr: SessionManager): void {
  const handlers: Handlers = {
    createSession:     (opts) => mgr.create(opts),
    sendMessage:       ({ sessionId, text, images }) => { mgr.send(sessionId, text, images); },
    answerQuestion:    ({ sessionId, toolUseId, answer }) => { mgr.answerQuestion(sessionId, toolUseId, answer); },
    killSession:       ({ sessionId }) => { mgr.kill(sessionId); },
    listSessions:      () => mgr.list(),
    updatePolicy:      ({ sessionId, policy }) => { mgr.updatePolicy(sessionId, policy); },
    getPolicy:         ({ sessionId }) => mgr.getPolicy(sessionId),
    renameSession:     ({ sessionId, name }) => { mgr.rename(sessionId, name); },
    resumeSession:     ({ sessionId }) => mgr.resume(sessionId),
    deleteSession:     ({ sessionId }) => { mgr.remove(sessionId); },
    getSessionEntries: ({ sessionId }) => mgr.getEntries(sessionId),
    getConfig:         () => loadConfig(),
    setConfig:         (config) => { saveConfig(config); },
    takeScreenshot: async (opts) => {
      if (!mainWindow) throw new Error("No window");
      const image = await mainWindow.webContents.capturePage();
      const name = opts?.filename ?? `buddy-${Date.now()}.png`;
      const p = path.join(process.env.TEMP ?? "/tmp", name);
      fs.writeFileSync(p, image.toPNG());
      return p;
    },
    winMinimize:    () => { mainWindow?.minimize(); },
    winMaximize:    () => {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize();
      else mainWindow?.maximize();
    },
    winClose:       () => { mainWindow?.close(); },
  };

  registerHandlers(
    (ch, fn) => ipcMain.handle(ch, fn as any),
    handlers,
  );
}

// ─── App lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  const config = loadConfig();
  manager = createSessionManager((event) => push?.sessionEvent(event), config.claudePath);
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
