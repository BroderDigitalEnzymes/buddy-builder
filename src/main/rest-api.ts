import { createServer, type IncomingMessage, type ServerResponse } from "http";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import type { Handlers, SessionEvent } from "../ipc.js";
import { dlog } from "./debug-log.js";

// Channels that require BrowserWindow / native dialogs — not exposable via REST
const GUI_ONLY = new Set([
  "winMinimize", "winMaximize", "winClose", "setAlwaysOnTop",
  "pickFolder", "takeScreenshot", "openInfoWindow",
  "focusPopout", "resumeInTerminal",
]);

type ScreenshotFn = (sessionId?: string) => Promise<string>;
type SseListener = (event: SessionEvent) => void;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}

export function startRestApi(
  handlers: Handlers,
  sseListeners: SseListener[],
  screenshotFn: ScreenshotFn,
): Promise<{ port: number; close: () => void }> {
  const availableChannels = Object.keys(handlers).filter((ch) => !GUI_ONLY.has(ch));

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const start = Date.now();
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      // ── Discovery ──────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/api") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: availableChannels }));
        dlog(`[rest] GET /api → ok (${Date.now() - start}ms)`);
        return;
      }

      // ── SSE event stream ───────────────────────────────────────
      if (req.method === "GET" && pathname === "/api/events") {
        const sessionFilter = url.searchParams.get("sessionId");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(":\n\n"); // SSE comment to confirm connection

        const listener: SseListener = (event) => {
          if (sessionFilter && event.sessionId !== sessionFilter) return;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        sseListeners.push(listener);
        dlog(`[rest] SSE connected${sessionFilter ? ` (session=${sessionFilter})` : ""}`);

        req.on("close", () => {
          const idx = sseListeners.indexOf(listener);
          if (idx >= 0) sseListeners.splice(idx, 1);
          dlog(`[rest] SSE disconnected`);
        });
        return;
      }

      // ── Screenshot ─────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/api/screenshot") {
        const sessionId = url.searchParams.get("sessionId") ?? undefined;
        const filePath = await screenshotFn(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: filePath }));
        dlog(`[rest] GET /api/screenshot → ${filePath} (${Date.now() - start}ms)`);
        return;
      }

      // ── Channel handler: POST /api/{channel} ──────────────────
      const match = pathname.match(/^\/api\/(\w+)$/);
      if (match && req.method === "POST") {
        const channel = match[1];
        if (!availableChannels.includes(channel)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: `unknown channel: ${channel}` }));
          dlog(`[rest] POST /api/${channel} → 404 (${Date.now() - start}ms)`);
          return;
        }

        const raw = await readBody(req);
        const input = raw.length > 0 ? JSON.parse(raw) : undefined;
        const fn = (handlers as Record<string, (arg: unknown) => unknown>)[channel];
        const result = await fn(input);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: result ?? null }));
        dlog(`[rest] POST /api/${channel} → ok (${Date.now() - start}ms)`);
        return;
      }

      // ── Fallback ───────────────────────────────────────────────
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      dlog(`[rest] ${req.method} ${pathname} → 404 (${Date.now() - start}ms)`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: msg }));
      dlog(`[rest] ${req.method} ${pathname} → error: ${msg} (${Date.now() - start}ms)`);
    }
  });

  const portFilePath = path.join(app.getPath("userData"), "rest-api-port");

  return new Promise((resolve, reject) => {
    const desiredPort = parseInt(process.env.BUDDY_REST_PORT ?? "0", 10);
    server.on("error", reject);
    server.listen(desiredPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      fs.writeFileSync(portFilePath, String(port), "utf-8");
      dlog(`[rest-api] listening on http://127.0.0.1:${port}`);
      resolve({
        port,
        close: () => {
          server.close();
          try { fs.unlinkSync(portFilePath); } catch {}
        },
      });
    });
  });
}
