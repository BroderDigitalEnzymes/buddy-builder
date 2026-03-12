import { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { registerHandlers, type Handlers } from "../ipc.js";
import { openInTerminal } from "./terminal-launcher.js";
import { createSessionManager, type SessionManager } from "./manager.js";
import { loadConfig, saveConfig } from "./config.js";
import { register, unregister, dispatch, findPopout, getMain, broadcast } from "./windows.js";
import { createSearchIndex, type SearchIndex } from "./search-index.js";
import { startBackgroundIndex, type BackgroundIndexHandle } from "./search-worker.js";
import { createTray, destroyTray } from "./tray.js";
import { autoUpdater } from "electron-updater";
import { dlog } from "./debug-log.js";
import { startRestApi } from "./rest-api.js";

// ─── Crash catchers ─────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  dlog("[CRASH] uncaughtException:", err.stack ?? err.message);
});
process.on("unhandledRejection", (reason) => {
  dlog("[CRASH] unhandledRejection:", String(reason));
});
process.on("exit", (code) => {
  dlog(`[CRASH] process.exit code=${code}`);
});

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
let restApiHandle: { port: number; close: () => void } | null = null;
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
  const win = new BrowserWindow({
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

// ─── Quit guard ─────────────────────────────────────────────────
// The main window is never destroyed — it hides on close so that
// closing a popout can't accidentally trigger window-all-closed.
// After any window hides or closes we call this to decide whether
// the app should actually quit.

function quitIfDone(caller: string): void {
  const all = BrowserWindow.getAllWindows();
  const visible = all.filter((w) => !w.isDestroyed() && w.isVisible());
  const tray = loadConfig().minimizeToTray;
  dlog(`[quit-guard] caller=${caller} allWindows=${all.length} visible=${visible.length} tray=${tray} isQuitting=${isQuitting}`);
  for (const w of all) {
    dlog(`  window id=${w.id} destroyed=${w.isDestroyed()} visible=${!w.isDestroyed() && w.isVisible()} title="${!w.isDestroyed() ? w.getTitle() : "?"}" isMain=${w === mainWindow}`);
  }
  if (tray) { dlog("[quit-guard] tray mode — staying alive"); return; }
  if (visible.length === 0) {
    dlog("[quit-guard] NO visible windows — calling app.quit()");
    app.quit();
  } else {
    dlog("[quit-guard] visible windows remain — staying alive");
  }
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

  mainWindow.on("close", (e) => {
    dlog(`[main] CLOSE event — isQuitting=${isQuitting}`);
    if (isQuitting) { dlog("[main] isQuitting=true, allowing destroy"); return; }
    e.preventDefault();
    mainWindow!.hide();
    dlog("[main] hidden instead of destroyed");
    quitIfDone("main-close");
  });

  mainWindow.on("closed", () => {
    dlog("[main] CLOSED event — window destroyed!");
    unregister(mainWindow!);
    mainWindow = null;
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
  dlog(`[popout] created id=${win.id} session=${sessionId}`);

  win.webContents.on("render-process-gone", (_e, details) => {
    dlog(`[popout] RENDER-PROCESS-GONE id=${win.id} reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on("destroyed", () => {
    dlog(`[popout] WEBCONTENTS-DESTROYED id=${win.id}`);
  });
  win.on("unresponsive", () => {
    dlog(`[popout] UNRESPONSIVE id=${win.id}`);
  });
  win.on("close", () => {
    dlog(`[popout] CLOSE event id=${win.id} session=${sessionId}`);
  });

  win.on("closed", () => {
    dlog(`[popout] CLOSED event id=${win.id} session=${sessionId}`);
    unregister(win);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dispatch({ kind: "popoutChanged", sessionId, poppedOut: false });
    }
    quitIfDone("popout-closed");
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

function buildHandlers(mgr: SessionManager): Handlers {
  return {
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
    changeModel:       ({ sessionId, model }) => mgr.changeModel(sessionId, model),
    forkSession:       ({ sessionId }) => mgr.fork(sessionId),
    changeEffort:      ({ sessionId, effort }) => mgr.changeEffort(sessionId, effort),
    resumeInTerminal:  ({ sessionId }) => {
      const { claudeSessionId, cwd, permissionMode } = mgr.getResumeInfo(sessionId);
      const skipPerms = permissionMode === "bypassPermissions" ? " --dangerously-skip-permissions" : "";
      openInTerminal(cwd ?? process.env.HOME ?? process.env.USERPROFILE ?? ".", `claude --resume ${claudeSessionId}${skipPerms}`);
    },
    exportSession:     ({ sessionId, format }) => mgr.exportSession(sessionId, format),
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
      if (!win || win.isDestroyed()) return;
      // Use destroy() instead of close() to avoid native crash on Windows frameless windows
      dlog(`[popInSession] destroying popout id=${win.id} session=${sessionId}`);
      setImmediate(() => {
        if (!win.isDestroyed()) win.destroy();
        // Show & focus the main window
        const main = getMain();
        if (main && !main.isDestroyed()) {
          main.show();
          main.focus();
        }
      });
    },
    focusPopout:    ({ sessionId }) => {
      const win = findPopout(sessionId);
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        return true;
      }
      return false;
    },
    setAlwaysOnTop: () => { /* handled separately below with raw ipcMain.handle */ },
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
}

function setupIpc(handlers: Handlers): void {
  registerHandlers(
    (ch, fn) => ipcMain.handle(ch, fn as any),
    handlers,
  );

  // Override window controls to use event.sender (not getFocusedWindow)
  // so popout close doesn't kill the main window.
  for (const ch of ["winClose", "winMinimize", "winMaximize", "setAlwaysOnTop"] as const) {
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
    const isMain = w === mainWindow;
    dlog(`[ipc:winClose] id=${w?.id ?? "null"} isMain=${isMain}`);
    if (!w) return;

    if (isMain) {
      // Main window: go through close() so the hide-on-close handler runs
      dlog("[ipc:winClose] main — calling close()");
      setImmediate(() => w.close());
    } else {
      // Popout: use destroy() to avoid native crash on Windows
      dlog(`[ipc:winClose] popout — calling destroy() on id=${w.id}`);
      setImmediate(() => {
        dlog(`[ipc:winClose] inside setImmediate, about to destroy id=${w.id}`);
        w.destroy();
        dlog(`[ipc:winClose] destroy() returned for id=${w.id}`);
      });
    }
  });
  ipcMain.handle("setAlwaysOnTop", (event, arg: { alwaysOnTop: boolean }) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (w && !w.isDestroyed()) w.setAlwaysOnTop(arg.alwaysOnTop);
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
  const sseListeners: Array<(event: import("../ipc.js").SessionEvent) => void> = [];
  const wrappedDispatch = (event: import("../ipc.js").SessionEvent) => {
    dispatch(event);
    for (const fn of sseListeners) fn(event);

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

  // Packaged Electron apps don't inherit shell PATH — resolve it from a login shell
  // so all subprocesses (sessions, auto-naming) can find claude, node, etc.
  let claudePath = config.claudePath;
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const shellPath = execSync(`${shell} -ilc "echo \\$PATH"`, { encoding: "utf-8" }).trim();
    if (shellPath) {
      process.env.PATH = shellPath;
      console.log("[shell] inherited PATH from login shell");
    }
    if (claudePath === "claude") {
      claudePath = execSync(`${shell} -ilc "which claude"`, { encoding: "utf-8" }).trim();
      console.log("[claude] resolved path:", claudePath);
    }
  } catch {
    console.warn("[shell] could not resolve login shell PATH");
  }

  manager = createSessionManager(wrappedDispatch, claudePath);

  const handlers = buildHandlers(manager);
  setupIpc(handlers);

  // REST API — reuses the same handlers object (DRY)
  const screenshotFn = async (sessionId?: string) => {
    const win = sessionId ? (findPopout(sessionId) ?? getMain()) : getMain();
    if (!win || win.isDestroyed()) throw new Error("No window available");
    const image = await win.webContents.capturePage();
    const p = path.join(process.env.TEMP ?? "/tmp", `buddy-${Date.now()}.png`);
    fs.writeFileSync(p, image.toPNG());
    return p;
  };
  startRestApi(handlers, sseListeners, screenshotFn).then((h) => {
    restApiHandle = h;
    dlog("[rest-api] port =", h.port);
  }).catch((err) => {
    console.error("[rest-api] Failed to start:", err);
  });

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

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    const iconPath = path.join(__dirname, "assets", "icon-256.png");
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  // Auto-update: check for new versions on launch
  autoUpdater.logger = console;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error("[updater]", err);
  });

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
  dlog("[app] WINDOW-ALL-CLOSED event fired");
  quitIfDone("window-all-closed");
});

app.on("before-quit", () => {
  dlog("[app] BEFORE-QUIT event");
  isQuitting = true;
  restApiHandle?.close();
  bgIndexHandle?.cancel();
  searchIndex?.close();
  manager?.dispose();
  destroyTray();
});
