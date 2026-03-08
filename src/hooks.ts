import { createServer, type Server } from "http";
import {
  PreToolUsePayloadSchema,
  PostToolUsePayloadSchema,
  StopPayloadSchema,
  type PreToolUsePayload,
  type PostToolUsePayload,
  type StopPayload,
} from "./schema.js";

// ─── Types ──────────────────────────────────────────────────────

export type HookEvent =
  | { readonly kind: "PreToolUse"; readonly payload: PreToolUsePayload }
  | { readonly kind: "PostToolUse"; readonly payload: PostToolUsePayload }
  | { readonly kind: "Stop"; readonly payload: StopPayload }
  | { readonly kind: "Notification"; readonly payload: Record<string, unknown> };

/** Return "allow" or "block:reason" */
export type PreToolUseHandler = (
  payload: PreToolUsePayload,
) => string | Promise<string>;

export type HookHandlers = {
  readonly onPreToolUse?: PreToolUseHandler;
  readonly onPostToolUse?: (payload: PostToolUsePayload) => void;
  readonly onStop?: (payload: StopPayload) => void;
  readonly onNotification?: (payload: Record<string, unknown>) => void;
  readonly onAny?: (event: HookEvent) => void;
};

export type HookServer = {
  readonly port: number;
  readonly close: () => void;
};

// ─── Hook command builder ───────────────────────────────────────
// Generates a bash one-liner that:
//   1. Reads JSON from stdin (Claude passes hook payload)
//   2. POSTs it to our local HTTP server
//   3. Checks the response for "block:" prefix → exit 2

export function buildHookCommand(hookName: string): string {
  // printf "%s" avoids echo's interpretation of escape sequences
  // curl -d @- reads POST body from stdin, avoiding shell injection
  return [
    `bash -c '`,
    `INPUT=$(cat); `,
    `RESP=$(printf "%s" "$INPUT" | curl -s -X POST `,
    `http://127.0.0.1:$BUDDY_PORT `,
    `-H "X-Hook: ${hookName}" `,
    `-d @- 2>/dev/null); `,
    `case "$RESP" in allow) exit 0;; block:*) echo "${`$`}{RESP#block:}" >&2; exit 2;; *) echo "Hook unreachable" >&2; exit 2;; esac`,
    `'`,
  ].join("");
}

// ─── Settings builder ───────────────────────────────────────────
// Generates the hooks section for --settings JSON

export function buildHookSettings(): Record<string, unknown> {
  const hookEntry = (name: string) => [
    { matcher: "", hooks: [{ type: "command", command: buildHookCommand(name) }] },
  ];

  return {
    hooks: {
      PreToolUse: hookEntry("PreToolUse"),
      PostToolUse: hookEntry("PostToolUse"),
      Stop: hookEntry("Stop"),
      Notification: hookEntry("Notification"),
    },
  };
}

// ─── Hook HTTP server ───────────────────────────────────────────

function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}

function parseHookPayload(hookName: string, body: string): HookEvent | null {
  try {
    const json = JSON.parse(body);
    switch (hookName) {
      case "PreToolUse":
        return { kind: "PreToolUse", payload: PreToolUsePayloadSchema.parse(json) };
      case "PostToolUse":
        return { kind: "PostToolUse", payload: PostToolUsePayloadSchema.parse(json) };
      case "Stop":
        return { kind: "Stop", payload: StopPayloadSchema.parse(json) };
      case "Notification":
        return { kind: "Notification", payload: json };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function handleRequest(
  hookName: string,
  body: string,
  handlers: HookHandlers,
): Promise<string> {
  const event = parseHookPayload(hookName, body);
  if (!event) return "allow";

  handlers.onAny?.(event);

  switch (event.kind) {
    case "PreToolUse":
      return handlers.onPreToolUse
        ? await handlers.onPreToolUse(event.payload)
        : "allow";
    case "PostToolUse":
      handlers.onPostToolUse?.(event.payload);
      return "allow";
    case "Stop":
      handlers.onStop?.(event.payload);
      return "allow";
    case "Notification":
      handlers.onNotification?.(event.payload);
      return "allow";
  }
}

export function startHookServer(handlers: HookHandlers): Promise<HookServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      const hookName = String(req.headers["x-hook"] ?? "unknown");
      const body = await readBody(req);
      const response = await handleRequest(hookName, body, handlers);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(response);
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}
