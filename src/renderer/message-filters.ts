import type { ChatEntry } from "../ipc.js";

/**
 * Regex patterns for messages that should be hidden from the chat display.
 * Add new patterns here to filter out noisy or irrelevant messages.
 */
const HIDDEN_PATTERNS: RegExp[] = [
  /^Stop hook feedback:/,
  /^Hook unreachable$/,
  /^[\s\u200B-\u200F\u2028-\u202F\u2060\uFEFF]*$/,
];

/** Returns true if the entry should be hidden from the chat UI. */
export function isHiddenEntry(entry: ChatEntry): boolean {
  // Result entries are now shown as checkpoint markers (no longer hidden)

  // Check text content on any entry that has it
  const text = (entry as any).text;
  if (typeof text === "string") {
    return HIDDEN_PATTERNS.some(re => re.test(text.trim()));
  }
  return false;
}
