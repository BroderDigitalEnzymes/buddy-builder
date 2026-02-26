import type { Readable } from "stream";
import {
  InitMessageSchema,
  AssistantMessageSchema,
  ResultMessageSchema,
  RateLimitEventSchema,
  UserEchoSchema,
  type OutputMessage,
} from "./schema.js";

// ─── Line-level NDJSON parser ───────────────────────────────────

export function parseLine(line: string): OutputMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }

  return parseJsonMessage(json);
}

function parseJsonMessage(json: any): OutputMessage | null {
  switch (json.type) {
    case "system":
      return safeParse(InitMessageSchema, json);
    case "assistant":
      return safeParse(AssistantMessageSchema, json);
    case "result":
      return safeParse(ResultMessageSchema, json);
    case "rate_limit_event":
      return safeParse(RateLimitEventSchema, json);
    case "user":
      return safeParse(UserEchoSchema, json);
    default:
      return null;
  }
}

function safeParse<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T } }, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data! : null;
}

// ─── Stream splitter ────────────────────────────────────────────
// Splits raw stream data into lines, handles partial chunks

export function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";

  return (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  };
}

// ─── Convenience: wire a readable stream to a message callback ──

export function pipeMessages(
  stream: Readable,
  onMessage: (msg: OutputMessage) => void,
  onUnknown?: (line: string) => void,
): void {
  const splitter = createLineSplitter((line) => {
    const msg = parseLine(line);
    if (msg) onMessage(msg);
    else onUnknown?.(line);
  });

  stream.on("data", splitter);
}
