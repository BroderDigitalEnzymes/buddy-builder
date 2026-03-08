import React, { useState, useEffect, useMemo } from "react";
import type { SessionMeta } from "../ipc.js";
import { api } from "./utils.js";
import { getToolMeta, TOOL_CATEGORIES } from "./tool-catalog.js";

// ─── Helpers ────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Tab types ──────────────────────────────────────────────────

type Tab = "overview" | "tools" | "mcp" | "commands";

const TABS: { key: Tab; label: (m: SessionMeta | null) => string }[] = [
  { key: "overview", label: () => "Overview" },
  { key: "tools", label: (m) => `Tools${m ? ` (${m.tools.length})` : ""}` },
  { key: "mcp", label: (m) => `MCP${m ? ` (${m.mcpServers.length})` : ""}` },
  { key: "commands", label: () => "Cmds" },
];

// ─── Overview Tab ───────────────────────────────────────────────

function OverviewTab({ meta }: { meta: SessionMeta }) {
  const cmdCount = meta.skills.length + meta.agents.length + meta.slashCommands.length;
  return (
    <div className="info-content">
      <div className="info-card-grid">
        <div className="info-card">
          <div className="info-card-label">Model</div>
          <div className="info-card-value">{meta.model ?? "—"}</div>
        </div>
        <div className="info-card">
          <div className="info-card-label">Version</div>
          <div className="info-card-value">{meta.claudeCodeVersion ?? "—"}</div>
        </div>
      </div>
      <div className="info-card full">
        <div className="info-card-label">Working Directory</div>
        <div className="info-card-value mono">{meta.cwd ?? "—"}</div>
      </div>
      <div className="info-card-grid">
        <div className="info-card">
          <div className="info-card-label">Permission Mode</div>
          <div className="info-card-value">{meta.permissionMode}</div>
        </div>
        <div className="info-card">
          <div className="info-card-label">Policy Preset</div>
          <div className="info-card-value">{meta.policyPreset}</div>
        </div>
      </div>
      {(meta.totalInputTokens > 0 || meta.totalCost > 0) && (
        <div className="info-card-grid">
          <div className="info-card">
            <div className="info-card-label">Tokens In / Out</div>
            <div className="info-card-value">
              {formatTokens(meta.totalInputTokens)} / {formatTokens(meta.totalOutputTokens)}
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-label">Cost</div>
            <div className="info-card-value">${meta.totalCost.toFixed(4)}</div>
          </div>
        </div>
      )}
      <div className="info-summary">
        {meta.tools.length} Tools &middot; {meta.mcpServers.length} MCP Servers &middot; {cmdCount} Commands
      </div>
    </div>
  );
}

// ─── Tools Tab ──────────────────────────────────────────────────

function ToolsTab({ tools }: { tools: string[] }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const categorized = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = tools.filter((t) => t.toLowerCase().includes(q));
    const groups: Record<string, string[]> = {};
    for (const cat of TOOL_CATEGORIES) groups[cat] = [];
    for (const t of filtered) {
      const meta = getToolMeta(t);
      if (!groups[meta.category]) groups[meta.category] = [];
      groups[meta.category].push(t);
    }
    return Object.entries(groups).filter(([, items]) => items.length > 0);
  }, [tools, search]);

  return (
    <div className="info-content">
      <input
        className="info-search"
        type="text"
        placeholder="Filter tools..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {categorized.map(([cat, items]) => (
        <div key={cat}>
          <div className="info-category">{cat}</div>
          {items.map((name) => {
            const meta = getToolMeta(name);
            const isExpanded = expanded === name;
            return (
              <div key={name} className={`info-tool-row ${isExpanded ? "expanded" : ""}`}>
                <button
                  className="info-tool-header"
                  onClick={() => setExpanded(isExpanded ? null : name)}
                >
                  <span className="info-tool-arrow">{isExpanded ? "\u25BC" : "\u25B6"}</span>
                  <span className="info-tool-name">{name}</span>
                </button>
                {isExpanded && meta.description && (
                  <div className="info-tool-detail">
                    <p className="info-tool-desc">{meta.description}</p>
                    {meta.params && meta.params.length > 0 && (
                      <table className="info-param-table">
                        <thead>
                          <tr><th>Parameter</th><th>Description</th></tr>
                        </thead>
                        <tbody>
                          {meta.params.map((p) => (
                            <tr key={p.name}>
                              <td className="mono">{p.name}</td>
                              <td>{p.desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {categorized.length === 0 && (
        <div className="info-empty">No tools match "{search}"</div>
      )}
    </div>
  );
}

// ─── MCP Tab ────────────────────────────────────────────────────

function McpTab({ servers }: { servers: { name: string; status: string }[] }) {
  if (servers.length === 0) {
    return <div className="info-content"><div className="info-empty">No MCP servers connected</div></div>;
  }
  return (
    <div className="info-content">
      {servers.map((s) => (
        <div key={s.name} className="info-server-card">
          <div className="info-server-name">{s.name}</div>
          <div className="info-server-status">
            <span className={`info-status-dot status-${s.status}`} />
            <span>{s.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Commands Tab ───────────────────────────────────────────────

function CommandsTab({ meta }: { meta: SessionMeta }) {
  const sections: { title: string; items: string[]; prefix: string }[] = [
    { title: "Skills", items: meta.skills, prefix: "/" },
    { title: "Agents", items: meta.agents, prefix: "" },
    { title: "Slash Commands", items: meta.slashCommands, prefix: "/" },
  ];

  const hasAny = sections.some((s) => s.items.length > 0);
  if (!hasAny) {
    return <div className="info-content"><div className="info-empty">No commands available</div></div>;
  }

  return (
    <div className="info-content">
      {sections.map((sec) => sec.items.length > 0 && (
        <div key={sec.title} className="info-chip-section">
          <div className="info-category">{sec.title}</div>
          <div className="info-chip-list">
            {sec.items.map((item) => (
              <span key={item} className="info-chip">{sec.prefix}{item}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── InfoWindow (root component) ────────────────────────────────

export function InfoWindow({ sessionId }: { sessionId: string }) {
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api().getSessionMeta({ sessionId }).then(setMeta).catch((err: unknown) => {
      setError(String(err));
    });
  }, [sessionId]);

  if (error) {
    return <div className="info-window"><div className="info-error">{error}</div></div>;
  }

  if (!meta) {
    return <div className="info-window"><div className="info-loading">Loading...</div></div>;
  }

  return (
    <div className="info-window">
      <div className="info-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`info-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label(meta)}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab meta={meta} />}
      {tab === "tools" && <ToolsTab tools={meta.tools} />}
      {tab === "mcp" && <McpTab servers={meta.mcpServers} />}
      {tab === "commands" && <CommandsTab meta={meta} />}
    </div>
  );
}
