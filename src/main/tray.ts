import { Tray, Menu, nativeImage } from "electron";
import * as path from "path";

let tray: Tray | null = null;

// Persistent reference prevents V8 from GC-ing the icon buffer data,
// which would cause the tray icon to visually vanish on Windows.
let persistentIcon: Electron.NativeImage | null = null;

export function createTray(callbacks: {
  onShowWindow: () => void;
  onQuit: () => void;
}): Tray {
  const assetsDir = path.join(__dirname, "assets");

  if (process.platform === "darwin") {
    persistentIcon = nativeImage.createFromPath(path.join(assetsDir, "icon-16.png"));
    persistentIcon.setTemplateImage(true);
  } else {
    // Use the .ico directly — it contains all needed resolutions and avoids
    // the fragile createFromBuffer + addRepresentation approach whose temp
    // Buffer objects can be GC'd, silently corrupting the icon on repaint.
    persistentIcon = nativeImage.createFromPath(path.join(assetsDir, "icon.ico"));
    if (persistentIcon.isEmpty()) {
      // Fallback to PNG if .ico fails (e.g. in dev mode path issues)
      persistentIcon = nativeImage.createFromPath(path.join(assetsDir, "icon-32.png"));
    }
  }

  tray = new Tray(persistentIcon);
  tray.setToolTip("Buddy Builder");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Window", click: callbacks.onShowWindow },
    { type: "separator" },
    { label: "Quit", click: callbacks.onQuit },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", callbacks.onShowWindow);

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    persistentIcon = null;
  }
}

export function isTrayAlive(): boolean {
  return tray !== null && !tray.isDestroyed();
}
