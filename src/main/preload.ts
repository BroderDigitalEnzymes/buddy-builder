import { contextBridge, ipcRenderer } from "electron";
import { createClientApi } from "../ipc.js";

contextBridge.exposeInMainWorld(
  "claude",
  createClientApi(
    (ch, arg) => ipcRenderer.invoke(ch, arg),
    (ch, handler) => ipcRenderer.on(ch, handler as any),
  ),
);
