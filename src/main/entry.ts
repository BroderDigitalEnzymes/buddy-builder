import { app, BrowserWindow, ipcMain, dialog, Notification } from "electron";
import * as path from "path";
import * as fs from "fs";
import { registerHandlers, type Handlers } from "../ipc.js";
import { openInTerminal } from "./terminal-launcher.js";
import { createSessionManager, type SessionManager } from "./manager.js";
import { loadConfig, saveConfig } from "./config.js";
import { register, unregister, dispatch, findPopout, broadcast } from "./windows.js";
import { createSearchIndex, type SearchIndex } from "./search-index.js";
import { startBackgroundIndex, type BackgroundIndexHandle } from "./search-worker.js";
import { createTray, destroyTray } from "./tray.js";

// ─── App identity (must be set before 'ready') ──────────────────

if (process.platform === "win32") {
  app.setAppUserModelId("com.buddy-builder.app");
}
app.setName("Buddy Builder");

// ─── Single instance lock ────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ─── Constants ───────────────────────────────────────────────────

const TEST_MODE = process.env.BUDDY_TEST === "1";

/** Matches --bg-0 in styles.css so there's no white flash on launch. */
const BG_COLOR = "#1a1d21";

const INITIAL_WIDTH = 1060;
const INITIAL_HEIGHT = 740;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

const POPOUT_WIDTH = 800;
const POPOUT_HEIGHT = 600;
const POPOUT_MIN_WIDTH = 500;
const POPOUT_MIN_HEIGHT = 350;

const INFO_WIDTH = 550;
const INFO_HEIGHT = 520;

// ─── Globals ─────────────────────────────────────────────────────

// Suppress GUI error dialogs — log to stderr instead
dialog.showErrorBox = (title: string, content: string) => {
  console.error(`[ERROR] ${title}: ${content}`);
};

let mainWindow: BrowserWindow | null = null;
let manager: SessionManager | null = null;
let searchIndex: SearchIndex | null = null;
let bgIndexHandle: BackgroundIndexHandle | null = null;
let mainActiveSessionId: string | null = null;
let isQuitting = false;

// ─── Shared window factory ──────────────────────────────────────

function createWindowBase(opts: {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  title?: string;
}): BrowserWindow {
  return new BrowserWindow({
    width: opts.width,
    height: opts.height,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    frame: false,
    backgroundColor: BG_COLOR,
    title: opts.title ?? "Buddy Builder",
    icon: path.join(__dirname, "assets", "icon-256.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}

// ─── Main window ─────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = createWindowBase({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  register({ kind: "main", win: mainWindow });

  // When "minimize to tray" is on, HIDE the window instead of destroying it.
  // This keeps the BrowserWindow alive (no window-all-closed, no GC issues)
  // and makes re-showing instant.
  mainWindow.on("close", (e) => {
    if (!isQuitting && loadConfig().minimizeToTray) {
      e.preventDefault();
      mainWindow!.hide();
    }
  });

  mainWindow.on("closed", () => {
    unregister(mainWindow!);
    mainWindow = null;
  });

  // Once the renderer is ready, push the current index status so it doesn't show stale data
  mainWindow.webContents.on("did-finish-load", () => {
    if (searchIndex) {
      mainWindow?.webContents.send("indexProgress", searchIndex.getStatus());
    }
  });

  if (TEST_MODE) runTestMode();
}

// ─── Pop-out windows ─────────────────────────────────────────────

function createPopoutWindow(sessionId: string): void {
  const existing = findPopout(sessionId);
  if (existing) { existing.focus(); return; }

  const win = createWindowBase({
    width: POPOUT_WIDTH,
    height: POPOUT_HEIGHT,
    minWidth: POPOUT_MIN_WIDTH,
    minHeight: POPOUT_MIN_HEIGHT,
    title: "Session",
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"), {
    hash: `popout=${sessionId}`,
  });

  register({ kind: "popout", win, sessionId });
  dispatch({ kind: "popoutChanged", sessionId, poppedOut: true });

  win.on("closed", () => {
    unregister(win);
    // Only notify main window if it's still alive (not during app shutdown)
    if (mainWindow && !mainWindow.isDestroyed()) {
      dispatch({ kind: "popoutChanged", sessionId, poppedOut: false });
    }
  });
}

// ─── Info window (read-only session metadata popup) ──────────────

function createInfoWindow(sessionId: string): void {
  const win = createWindowBase({
    width: INFO_WIDTH,
    height: INFO_HEIGHT,
    title: "Session Info",
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"), {
    hash: `info=${sessionId}`,
  });

  // Not registered in event dispatch — it's a read-only snapshot
}

// ─── Test mode ───────────────────────────────────────────────────

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
    approvePermission: ({ sessionId, toolUseId, allow }) => { mgr.approvePermission(sessionId, toolUseId, allow); },
    interruptSession:  ({ sessionId }) => { mgr.interrupt(sessionId); },
    killSession:       ({ sessionId }) => { mgr.kill(sessionId); },
    listSessions:      () => mgr.list(),
    updatePolicy:      ({ sessionId, policy }) => { mgr.updatePolicy(sessionId, policy); },
    getPolicy:         ({ sessionId }) => mgr.getPolicy(sessionId),
    renameSession:     ({ sessionId, name }) => { mgr.rename(sessionId, name); },
    setFavorite:       ({ sessionId, favorite }) => { mgr.setFavorite(sessionId, favorite); },
    resumeSession:     ({ sessionId }) => mgr.resume(sessionId),
    resumeInTerminal:  ({ sessionId }) => {
      const { claudeSessionId, cwd } = mgr.getResumeInfo(sessionId);
      openInTerminal(cwd ?? process.env.HOME ?? process.env.USERPROFILE ?? ".", `claude --resume ${claudeSessionId}`);
    },
    deleteSession:     ({ sessionId }) => { mgr.remove(sessionId); },
    getSessionEntries: ({ sessionId }) => mgr.getEntries(sessionId),
    getConfig:         () => loadConfig(),
    setConfig:         (config) => { saveConfig(config); },
    createProjectFolder: ({ parentDir, folderName }) => {
      const dir = path.join(parentDir, folderName);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    pickFolder: async () => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
        title: "Choose project directory",
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    takeScreenshot: async (opts) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) throw new Error("No window");
      const image = await win.webContents.capturePage();
      const name = opts?.filename ?? `buddy-${Date.now()}.png`;
      const p = path.join(process.env.TEMP ?? "/tmp", name);
      fs.writeFileSync(p, image.toPNG());
      return p;
    },
    getSessionMeta: ({ sessionId }) => mgr.getMeta(sessionId),
    openInfoWindow: ({ sessionId }) => { createInfoWindow(sessionId); },
    popOutSession:  ({ sessionId }) => { createPopoutWindow(sessionId); },
    popInSession:   ({ sessionId }) => {
      const win = findPopout(sessionId);
      // Defer close so the IPC invoke response can be sent before the window is destroyed
      if (win && !win.isDestroyed()) setImmediate(() => win.close());
    },
    focusPopout:    ({ sessionId }) => {
      const win = findPopout(sessionId);
      if (win && !win.isDestroyed()) { win.focus(); return true; }
      return false;
    },
    searchSessions: ({ query, limit }) => {
      if (!searchIndex || !manager) return [];
      const raw = searchIndex.search(query, limit);
      // Enrich with session names from manager
      const sessionMap = new Map(manager.list().map((s) => [s.id, s]));
      return raw.map((r) => {
        const info = sessionMap.get(r.sessionId);
        return {
          sessionId: r.sessionId,
          sessionName: info?.name ?? "Unknown",
          projectName: info?.projectName ?? "",
          cwd: info?.cwd ?? null,
          snippet: r.snippet,
          contentType: r.contentType,
          lastActiveAt: info?.lastActiveAt ?? 0,
          rank: r.rank,
        };
      }).filter((r) => r.lastActiveAt > 0); // drop sessions that no longer exist
    },
    getIndexStatus: () => searchIndex?.getStatus() ?? { totalSessions: 0, indexedSessions: 0, isIndexing: false },
    triggerReindex: () => {
      if (!searchIndex || !manager) return;
      bgIndexHandle?.cancel();
      const sessions = manager.getIndexableData();
      bgIndexHandle = startBackgroundIndex(searchIndex, sessions, (status) => {
        broadcast("indexProgress", status);
      });
    },
    winMinimize:    () => { BrowserWindow.getFocusedWindow()?.minimize(); },
    winMaximize:    () => {
      const w = BrowserWindow.getFocusedWindow();
      if (w?.isMaximized()) w.unmaximize();
      else w?.maximize();
    },
    winClose:       () => {
      const w = BrowserWindow.getFocusedWindow();
      // Defer close so the IPC invoke response can be sent before the window is destroyed
      if (w) setImmediate(() => w.close());
    },
  };

  registerHandlers(
    (ch, fn) => ipcMain.handle(ch, fn as any),
    handlers,
  );

  // Override window controls to use event.sender (not getFocusedWindow)
  // so popout close doesn't kill the main window.
  for (const ch of ["winClose", "winMinimize", "winMaximize"] as const) {
    ipcMain.removeHandler(ch);
  }
  ipcMain.handle("winMinimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("winMaximize", (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (w?.isMaximized()) w.unmaximize();
    else w?.maximize();
  });
  ipcMain.handle("winClose", (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (w) setImmediate(() => w.close());
  });
}

// ─── App lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  const config = loadConfig();

  // Wrap dispatch to also schedule re-indexing on result/exit events
  const reindexTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const wrappedDispatch = (event: import("../ipc.js").SessionEvent) => {
    dispatch(event);

    // Desktop notification when a session becomes idle and its window isn't focused
    if (event.kind === "stateChange" && event.to === "idle") {
      const popout = findPopout(event.sessionId);
      const popoutFocused = popout ? popout.isFocused() : false;
      const mainFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && mainActiveSessionId === event.sessionId;
      if (!popoutFocused && !mainFocused) {
        const sessionName = manager?.list().find((s) => s.id === event.sessionId)?.name ?? "Session";
        const notif = new Notification({
          title: "Buddy Builder",
          body: `${sessionName} is waiting for input`,
        });
        notif.on("click", () => {
          const pw = findPopout(event.sessionId);
          if (pw && !pw.isDestroyed()) {
            pw.show();
            pw.focus();
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("focusSession", event.sessionId);
          } else {
            createWindow();
            mainWindow!.webContents.once("did-finish-load", () => {
              mainWindow!.webContents.send("focusSession", event.sessionId);
            });
          }
        });
        notif.show();
      }
    }

    if (
      searchIndex &&
      manager &&
      (event.kind === "result" || event.kind === "exit")
    ) {
      // Debounce 2s per session
      const existing = reindexTimers.get(event.sessionId);
      if (existing) clearTimeout(existing);
      reindexTimers.set(
        event.sessionId,
        setTimeout(() => {
          reindexTimers.delete(event.sessionId);
          if (!searchIndex || !manager) return;
          const data = manager.getIndexableData().find(
            (d) => d.sessionId === event.sessionId
          );
          if (data?.transcriptPath) {
            try {
              searchIndex.indexSession(data.sessionId, data.transcriptPath, data.sessionName);
              broadcast("indexProgress", searchIndex.getStatus());
            } catch (err) {
              console.error("[search] live re-index failed:", err);
            }
          }
        }, 2000)
      );
    }
  };

  manager = createSessionManager(wrappedDispatch, config.claudePath);
  setupIpc(manager);

  // Initialize search index and start background indexing
  try {
    searchIndex = createSearchIndex();
    const sessions = manager.getIndexableData();
    bgIndexHandle = startBackgroundIndex(searchIndex, sessions, (status) => {
      broadcast("indexProgress", status);
    });
  } catch (err) {
    console.error("[search] Failed to create search index:", err);
  }

  createWindow();

  createTray({
    onShowWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    },
    onQuit: () => app.quit(),
  });

  ipcMain.on("reportActiveSession", (_event, id: string | null) => {
    mainActiveSessionId = id;
  });

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // When minimizeToTray is on, the main window hides instead of closing,
  // so this only fires for popout windows or when the setting is off.
  if (!loadConfig().minimizeToTray) {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  bgIndexHandle?.cancel();
  searchIndex?.close();
  manager?.dispose();
  destroyTray();
});
