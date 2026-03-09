import { readFileSync } from "fs";

// ─── Types ──────────────────────────────────────────────────────

export type SearchableChunk = {
  contentType: "user" | "assistant" | "tool_name" | "tool_input" | "tool_result";
  text: string;
};

// ─── Lightweight JSONL text extractor ───────────────────────────

const MAX_CHUNK_LEN = 2000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function extractSearchableText(filePath: string): SearchableChunk[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const chunks: SearchableChunk[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip non-message types
    if (
      obj.type === "queue-operation" ||
      obj.type === "progress" ||
      obj.type === "file-history-snapshot" ||
      obj.type === "system"
    ) {
      continue;
    }

    // User messages
    if (obj.type === "user" && obj.message?.role === "user") {
      const content = obj.message.content;
      // Skip tool_result messages
      if (
        Array.isArray(content) &&
        content.length > 0 &&
        content[0]?.type === "tool_result"
      ) {
        continue;
      }
      const text = extractText(content);
      if (text) {
        chunks.push({ contentType: "user", text: truncate(text, MAX_CHUNK_LEN) });
      }
      continue;
    }

    // Assistant messages
    if (obj.type === "assistant" && obj.message?.role === "assistant") {
      const content = obj.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === "text" && block.text) {
          chunks.push({
            contentType: "assistant",
            text: truncate(block.text, MAX_CHUNK_LEN),
          });
        } else if (block.type === "tool_use") {
          if (block.name) {
            chunks.push({ contentType: "tool_name", text: block.name });
          }
          if (block.input) {
            const inputStr =
              typeof block.input === "string"
                ? block.input
                : JSON.stringify(block.input);
            chunks.push({
              contentType: "tool_input",
              text: truncate(inputStr, MAX_CHUNK_LEN),
            });
          }
        }
      }
      continue;
    }

    // Tool results in "result" type messages
    if (obj.type === "result" && obj.result) {
      const text =
        typeof obj.result === "string"
          ? obj.result
          : JSON.stringify(obj.result);
      if (text) {
        chunks.push({
          contentType: "tool_result",
          text: truncate(text, MAX_CHUNK_LEN),
        });
      }
    }
  }

  return chunks;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n");
  }
  return "";
}
