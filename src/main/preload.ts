import { contextBridge, ipcRenderer } from "electron";
import { createClientApi } from "../ipc.js";

const clientApi = createClientApi(
  (ch, arg) => ipcRenderer.invoke(ch, arg),
  (ch, handler) => ipcRenderer.on(ch, handler as any),
);

contextBridge.exposeInMainWorld("claude", {
  ...clientApi,
  reportActiveSession: (id: string | null) => ipcRenderer.send("reportActiveSession", id),
});
