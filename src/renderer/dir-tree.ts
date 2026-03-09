import type { SessionData } from "./store.js";

// ─── Types ──────────────────────────────────────────────────────

export type DirTreeNode = {
  segment: string;
  fullPath: string;
  children: Map<string, DirTreeNode>;
  sessions: SessionData[];
};

export type DirTree = {
  commonPrefix: string;
  roots: DirTreeNode[];
  rootSessions: SessionData[];
  unknown: SessionData[];
};

// ─── Helpers ────────────────────────────────────────────────────

export function pathSegments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

export function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const segArrays = paths.map(pathSegments);
  const minLen = Math.min(...segArrays.map(s => s.length));
  let shared = 0;
  for (let i = 0; i < minLen; i++) {
    if (segArrays.every(a => a[i] === segArrays[0][i])) shared = i + 1;
    else break;
  }
  if (shared === 0) return "/";
  return "/" + segArrays[0].slice(0, shared).join("/");
}

export function countSessions(node: DirTreeNode): number {
  let count = node.sessions.length;
  for (const child of node.children.values()) count += countSessions(child);
  return count;
}

// ─── Tree builder ───────────────────────────────────────────────

export function buildDirTree(sessions: SessionData[]): DirTree {
  const unknown: SessionData[] = [];
  const withCwd: SessionData[] = [];
  for (const s of sessions) {
    if (s.cwd) withCwd.push(s);
    else unknown.push(s);
  }
  const cwds = withCwd.map(s => s.cwd!);
  const commonPrefix = findCommonPrefix(cwds);
  const prefixSegs = pathSegments(commonPrefix);
  const rootMap = new Map<string, DirTreeNode>();
  const rootSessions: SessionData[] = [];

  for (const s of withCwd) {
    const segs = pathSegments(s.cwd!);
    const relSegs = segs.slice(prefixSegs.length);
    if (relSegs.length === 0) { rootSessions.push(s); continue; }
    let currentMap = rootMap;
    let currentPath = commonPrefix;
    let node: DirTreeNode | undefined;
    for (const seg of relSegs) {
      currentPath = currentPath + "/" + seg;
      if (!currentMap.has(seg)) {
        currentMap.set(seg, { segment: seg, fullPath: currentPath, children: new Map(), sessions: [] });
      }
      node = currentMap.get(seg)!;
      currentMap = node.children;
    }
    node!.sessions.push(s);
  }
  const roots = [...rootMap.values()].sort((a, b) => a.segment.localeCompare(b.segment));
  return { commonPrefix, roots, rootSessions, unknown };
}
