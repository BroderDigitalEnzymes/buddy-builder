import type { SearchIndex, IndexStatus } from "./search-index.js";

export type IndexingSession = {
  sessionId: string;
  transcriptPath: string | null;
  sessionName?: string;
};

export type BackgroundIndexHandle = {
  cancel(): void;
};

/**
 * Indexes sessions in background using setImmediate chunking.
 * Processes CHUNK_SIZE sessions per tick to avoid blocking the event loop.
 */
export function startBackgroundIndex(
  index: SearchIndex,
  sessions: IndexingSession[],
  onProgress: (status: IndexStatus) => void,
): BackgroundIndexHandle {
  const CHUNK_SIZE = 5;
  let cancelled = false;
  let i = 0;

  index.setTotalSessions(sessions.filter((s) => s.transcriptPath).length);
  index.setIndexing(true);

  function processChunk(): void {
    if (cancelled) {
      index.setIndexing(false);
      return;
    }

    const end = Math.min(i + CHUNK_SIZE, sessions.length);
    for (; i < end; i++) {
      const s = sessions[i];
      if (s.transcriptPath) {
        try {
          index.indexSession(s.sessionId, s.transcriptPath, s.sessionName);
        } catch (err) {
          console.error(`[search-worker] Failed to index ${s.sessionId}:`, err);
        }
      }
    }

    onProgress(index.getStatus());

    if (i < sessions.length) {
      setImmediate(processChunk);
    } else {
      index.setIndexing(false);
      onProgress(index.getStatus());
    }
  }

  setImmediate(processChunk);

  return {
    cancel() {
      cancelled = true;
    },
  };
}
