import type { ChildProcess } from "child_process";
import { createEmitter, type Emitter } from "./emitter.js";
import { startHookServer, buildHookSettings, type HookServer } from "./hooks.js";
import { spawnClaude } from "./process.js";
import { pipeMessages } from "./parse.js";
import {
  SessionConfigSchema,
  type SessionConfig,
  type SessionState,
  type ToolPolicy,
  type ToolAction,
  type InitMessage,
  type AssistantMessage,
  type ResultMessage,
  type RateLimitEvent,
  type TextBlock,
  type ToolUseBlock,
  type PreToolUsePayload,
  type PostToolUsePayload,
  type StopPayload,
} from "./schema.js";
import type { ImageData } from "./ipc.js";

// ─── Event Map ──────────────────────────────────────────────────

export type SessionEventMap = {
  // Lifecycle
  ready: InitMessage;
  stateChange: { from: SessionState; to: SessionState };
  exit: { code: number | null; signal: string | null };

  // Response stream
  message: AssistantMessage;
  text: { text: string; parentToolUseId?: string };
  result: ResultMessage;
  rateLimit: RateLimitEvent;

  // Tool lifecycle (from hooks)
  toolStart: { toolName: string; toolInput: Record<string, unknown>; toolUseId: string; parentToolUseId?: string };
  toolEnd: { toolName: string; toolInput: Record<string, unknown>; response: unknown; toolUseId: string };
  toolBlocked: { toolName: string; toolInput: Record<string, unknown>; reason: string; parentToolUseId?: string };

  // Claude stopped generating
  stop: { stopHookActive: boolean; lastMessage: string };

  // Errors & warnings
  error: Error;
  warn: string;
};

// ─── Session interface ──────────────────────────────────────────

export type Session = {
  send(text: string, images?: ImageData[]): void;
  prompt(text: string): Promise<ResultMessage>;

  on: Emitter<SessionEventMap>["on"];
  once: Emitter<SessionEventMap>["once"];
  off: Emitter<SessionEventMap>["off"];

  get state(): SessionState;
  get sessionId(): string | undefined;
  get totalCost(): number;

  setToolPolicy(policy: ToolPolicy | null): void;
  answerQuestion(toolUseId: string, answer: string): void;
  kill(): void;
  dispose(): Promise<void>;
};

// ─── Helpers ────────────────────────────────────────────────────

function writeUserMessage(proc: ChildProcess, text: string, images?: ImageData[]): void {
  const content: unknown[] = [];
  if (images) {
    for (const img of images) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }
  }
  content.push({ type: "text", text });
  const msg = JSON.stringify({
    type: "user",
    message: { role: "user", content },
  });
  proc.stdin!.write(msg + "\n");
}

function extractText(msg: AssistantMessage): string {
  return msg.message.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractToolUses(msg: AssistantMessage): ToolUseBlock[] {
  return msg.message.content.filter(
    (b): b is ToolUseBlock => b.type === "tool_use",
  );
}

// ─── Factory ────────────────────────────────────────────────────

export async function createSession(
  rawConfig: SessionConfig = {},
): Promise<Session> {
  const config = SessionConfigSchema.parse(rawConfig);
  const emitter = createEmitter<SessionEventMap>();

  // ── State ──
  let state: SessionState = "idle";
  let sessionId: string | undefined;
  let totalCost = 0;
  let toolPolicy: ToolPolicy | null = null;

  function transition(to: SessionState): void {
    if (state === to) return;
    const from = state;
    state = to;
    emitter.emit("stateChange", { from, to });
  }

  // ── Default tool policy: allow everything ──
  async function resolveToolAction(
    payload: PreToolUsePayload,
  ): Promise<string> {
    if (!toolPolicy) return "allow";
    try {
      const decision: ToolAction = await toolPolicy(
        payload.tool_name,
        payload.tool_input,
      );
      if (decision.action === "block") {
        emitter.emit("toolBlocked", {
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
          reason: decision.reason,
          parentToolUseId: payload.parent_tool_use_id ?? undefined,
        });
        return `block:${decision.reason}`;
      }
    } catch (err) {
      emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
    return "allow";
  }

  // ── Pending user questions (AskUserQuestion interception) ──
  const pendingQuestions = new Map<string, (answer: string) => void>();

  // ── Hook server ──
  const hookServer: HookServer = await startHookServer({
    onPreToolUse: async (payload: PreToolUsePayload) => {
      emitter.emit("toolStart", {
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        toolUseId: payload.tool_use_id,
        parentToolUseId: payload.parent_tool_use_id ?? undefined,
      });

      // Intercept AskUserQuestion: hold the hook response until the UI answers
      if (payload.tool_name === "AskUserQuestion") {
        const answer = await new Promise<string>((resolve) => {
          pendingQuestions.set(payload.tool_use_id, resolve);
        });
        // Emit toolEnd so the UI shows the answer
        emitter.emit("toolEnd", {
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
          response: answer,
          toolUseId: payload.tool_use_id,
        });
        // Block with the answer — Claude receives it as feedback
        return `block:User responded: ${answer}`;
      }

      return resolveToolAction(payload);
    },
    onPostToolUse: (payload: PostToolUsePayload) => {
      emitter.emit("toolEnd", {
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        response: payload.tool_response,
        toolUseId: payload.tool_use_id,
      });
    },
    onStop: (payload: StopPayload) => {
      emitter.emit("stop", {
        stopHookActive: payload.stop_hook_active,
        lastMessage: payload.last_assistant_message,
      });
    },
  });

  // ── Spawn process ──
  const settingsJson = JSON.stringify(buildHookSettings());
  const proc = spawnClaude(config, hookServer.port, settingsJson);

  // ── Wire stdout ──
  pipeMessages(
    proc.stdout!,
    (msg) => {
      switch (msg.type) {
        case "system":
          if (!("model" in msg)) break; // skip non-init system messages
          sessionId = msg.session_id;
          emitter.emit("ready", msg as InitMessage);
          break;

        case "assistant": {
          emitter.emit("message", msg);
          const text = extractText(msg);
          if (text) emitter.emit("text", { text, parentToolUseId: msg.parent_tool_use_id ?? undefined });
          break;
        }

        case "result":
          totalCost = msg.total_cost_usd;
          transition("idle");
          emitter.emit("result", msg);
          break;

        case "rate_limit_event":
          emitter.emit("rateLimit", msg);
          break;
      }
    },
    (line) => {
      // Unknown stdout line — could be a new message type
      try {
        const json = JSON.parse(line);
        if (json.type) {
          // Known-unknown: log for debugging, don't crash
          // console.debug(`[session] unknown message type: ${json.type}`);
        }
      } catch { /* not JSON, ignore */ }
    },
  );

  // ── Wire stderr (warnings, not fatal) ──
  proc.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      emitter.emit("warn", text);
    }
  });

  // ── Wire process exit ──
  proc.on("exit", (code, signal) => {
    transition("dead");
    emitter.emit("exit", { code, signal });
    hookServer.close();
  });

  proc.on("error", (err) => {
    transition("dead");
    emitter.emit("error", err);
    hookServer.close();
  });

  // ── Public API ──
  const session: Session = {
    send(text: string, images?: ImageData[]): void {
      if (state === "dead") throw new Error("Session is dead");
      if (state === "busy") throw new Error("Session is busy — await the current result first");
      transition("busy");
      writeUserMessage(proc, text, images);
    },

    prompt(text: string): Promise<ResultMessage> {
      return new Promise((resolve, reject) => {
        try {
          session.send(text);
        } catch (err) {
          reject(err);
          return;
        }
        const cleanup = () => { offResult(); offExit(); };
        const offResult = emitter.once("result", (result) => {
          cleanup();
          resolve(result);
        });
        const offExit = emitter.once("exit", (ev) => {
          cleanup();
          reject(new Error(`Process exited (code=${ev.code}) before result`));
        });
      });
    },

    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),

    get state() { return state; },
    get sessionId() { return sessionId; },
    get totalCost() { return totalCost; },

    setToolPolicy(policy: ToolPolicy | null): void {
      toolPolicy = policy;
    },

    answerQuestion(toolUseId: string, answer: string): void {
      const resolve = pendingQuestions.get(toolUseId);
      if (resolve) {
        pendingQuestions.delete(toolUseId);
        resolve(answer);
      }
    },

    kill(): void {
      if (state !== "dead") {
        proc.kill();
      }
    },

    async dispose(): Promise<void> {
      session.kill();
      hookServer.close();
      // Give the process a moment to exit
      await new Promise<void>((resolve) => {
        if (state === "dead") { resolve(); return; }
        const off = emitter.once("exit", () => { resolve(); });
        setTimeout(() => { off(); resolve(); }, 2000);
      });
    },
  };

  return session;
}
