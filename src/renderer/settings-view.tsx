import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { PermissionMode } from "../ipc.js";
import { PERM_ITEMS } from "./chat-header.js";
import { api } from "./utils.js";

// ─── Category definitions ───────────────────────────────────────

type SettingCategory = {
  id: string;
  label: string;
};

const CATEGORIES: SettingCategory[] = [
  { id: "general", label: "General" },
  { id: "sessions", label: "Sessions" },
  { id: "window", label: "Window" },
  { id: "about", label: "About" },
];

// ─── Individual setting item ────────────────────────────────────

function SettingItem({ id, category, title, description, children, searchQuery }: {
  id: string;
  category: string;
  title: string;
  description: string;
  children: React.ReactNode;
  searchQuery?: string;
}) {
  // Highlight matching text
  const highlight = useCallback((text: string) => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="sv-highlight">{text.slice(idx, idx + searchQuery.length)}</span>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  }, [searchQuery]);

  return (
    <div className="sv-item" data-setting-id={id} data-category={category}>
      <div className="sv-item-title">{highlight(title)}</div>
      <div className="sv-item-desc">{highlight(description)}</div>
      <div className="sv-item-control">{children}</div>
    </div>
  );
}

// ─── Toggle control ─────────────────────────────────────────────

function ToggleControl({ checked, onChange, label }: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <label className="sv-toggle-row">
      <button
        type="button"
        className={`sv-toggle-switch${checked ? " active" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="sv-toggle-knob" />
      </button>
      <span className="sv-toggle-label">{label}</span>
    </label>
  );
}

// ─── Select control ─────────────────────────────────────────────

function SelectControl<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (val: T) => void;
}) {
  return (
    <select
      className="sv-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

// ─── Settings View ──────────────────────────────────────────────

export function SettingsView() {
  const [claudePath, setClaudePath] = useState("");
  const [defaultPerm, setDefaultPerm] = useState<PermissionMode>("default");
  const [defaultFolder, setDefaultFolder] = useState("");
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [popOutByDefault, setPopOutByDefault] = useState(false);
  const [status, setStatus] = useState("");
  const [activeCategory, setActiveCategory] = useState("general");
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api().getConfig().then((cfg: any) => {
      setClaudePath(cfg.claudePath);
      setDefaultPerm(cfg.defaultPermissionMode ?? "default");
      setDefaultFolder(cfg.defaultProjectsFolder ?? "");
      setMinimizeToTray(cfg.minimizeToTray ?? true);
      setPopOutByDefault(cfg.popOutByDefault ?? false);
    });
  }, []);

  // Auto-save on any change (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef({ claudePath, defaultPerm, defaultFolder, minimizeToTray, popOutByDefault });
  configRef.current = { claudePath, defaultPerm, defaultFolder, minimizeToTray, popOutByDefault };

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const c = configRef.current;
      try {
        await api().setConfig({
          claudePath: c.claudePath,
          defaultPermissionMode: c.defaultPerm,
          defaultProjectsFolder: c.defaultFolder,
          minimizeToTray: c.minimizeToTray,
          popOutByDefault: c.popOutByDefault,
        });
        setStatus("Settings saved");
        setTimeout(() => setStatus(""), 2000);
      } catch (err) {
        setStatus(`Error: ${err}`);
      }
    }, 600);
  }, []);

  const updateClaudePath = useCallback((v: string) => { setClaudePath(v); scheduleSave(); }, [scheduleSave]);
  const updateDefaultPerm = useCallback((v: PermissionMode) => { setDefaultPerm(v); scheduleSave(); }, [scheduleSave]);
  const updateDefaultFolder = useCallback((v: string) => { setDefaultFolder(v); scheduleSave(); }, [scheduleSave]);
  const updateMinimizeToTray = useCallback((v: boolean) => { setMinimizeToTray(v); scheduleSave(); }, [scheduleSave]);
  const updatePopOutByDefault = useCallback((v: boolean) => { setPopOutByDefault(v); scheduleSave(); }, [scheduleSave]);

  const handleBrowseFolder = useCallback(async () => {
    const folder = await api().pickFolder();
    if (folder) { setDefaultFolder(folder); scheduleSave(); }
  }, [scheduleSave]);

  const scrollToCategory = useCallback((catId: string) => {
    setActiveCategory(catId);
    setSearchQuery("");
    const el = scrollRef.current?.querySelector(`[data-category-header="${catId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Track which category header is in view
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || searchQuery) return;
    const headers = container.querySelectorAll<HTMLElement>("[data-category-header]");
    if (!headers.length) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = (entry.target as HTMLElement).dataset.categoryHeader;
          if (id) setActiveCategory(id);
        }
      }
    }, { root: container, rootMargin: "-10% 0px -80% 0px" });

    headers.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [searchQuery]);

  // All settings data for search filtering
  const allSettings = useMemo(() => [
    { id: "claudePath", category: "general", title: "General: Claude CLI Path", description: "Command name or full path to the Claude CLI executable.", keywords: "claude path executable binary" },
    { id: "defaultPerm", category: "sessions", title: "Sessions: Default Permission Mode", description: "Permission mode used when creating new sessions.", keywords: "permission policy security mode" },
    { id: "defaultFolder", category: "sessions", title: "Sessions: Default Projects Folder", description: "New sessions will create a subfolder here. Leave empty to use the folder picker each time.", keywords: "folder directory project path browse" },
    { id: "popOutByDefault", category: "sessions", title: "Sessions: Pop Out By Default", description: "Automatically open new and resumed sessions in a separate popout window.", keywords: "popout window separate detach" },
    { id: "minimizeToTray", category: "window", title: "Window: Minimize to Tray", description: "Keep the application running in the background when all windows are closed.", keywords: "tray background minimize close" },
  ], []);

  const q = searchQuery.toLowerCase();
  const filteredSettings = useMemo(() => {
    if (!q) return null; // null = show all
    return allSettings.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.keywords.toLowerCase().includes(q)
    );
  }, [q, allSettings]);

  const isVisible = useCallback((settingId: string) => {
    if (!filteredSettings) return true;
    return filteredSettings.some((s) => s.id === settingId);
  }, [filteredSettings]);

  const visibleCategories = useMemo(() => {
    if (!filteredSettings) return CATEGORIES;
    const cats = new Set(filteredSettings.map((s) => s.category));
    return CATEGORIES.filter((c) => cats.has(c.id));
  }, [filteredSettings]);

  // Ctrl+F to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const permOptions = PERM_ITEMS.map((i) => ({ value: i.value, label: i.label }));

  return (
    <div id="settings-view">
      {/* Search bar */}
      <div className="sv-search-bar">
        <svg className="sv-search-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
        </svg>
        <input
          ref={searchInputRef}
          className="sv-search-input"
          type="text"
          placeholder="Search settings"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          spellCheck={false}
        />
        {searchQuery && (
          <button className="sv-search-clear" onClick={() => setSearchQuery("")}>&times;</button>
        )}
        {status && <span className="sv-autosave-status">{status}</span>}
      </div>

      <div className="sv-body">
        {/* Category nav */}
        <nav className="sv-nav">
          {visibleCategories.map((cat) => (
            <button
              key={cat.id}
              className={`sv-nav-item ${activeCategory === cat.id && !searchQuery ? "active" : ""}`}
              onClick={() => scrollToCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        {/* Settings list */}
        <div className="sv-content" ref={scrollRef}>
          {filteredSettings && filteredSettings.length === 0 && (
            <div className="sv-no-results">
              No settings found matching "{searchQuery}"
            </div>
          )}

          {/* General */}
          {(!filteredSettings || visibleCategories.some((c) => c.id === "general")) && (
            <>
              <div className="sv-category-header" data-category-header="general">General</div>

              {isVisible("claudePath") && (
                <SettingItem
                  id="claudePath"
                  category="general"
                  title="General: Claude CLI Path"
                  description="Command name (e.g. &quot;claude&quot;) or full path to the Claude CLI executable."
                  searchQuery={searchQuery}
                >
                  <input
                    className="sv-text-input"
                    type="text"
                    value={claudePath}
                    onChange={(e) => updateClaudePath(e.target.value)}
                    placeholder="claude"
                    spellCheck={false}
                  />
                </SettingItem>
              )}
            </>
          )}

          {/* Sessions */}
          {(!filteredSettings || visibleCategories.some((c) => c.id === "sessions")) && (
            <>
              <div className="sv-category-header" data-category-header="sessions">Sessions</div>

              {isVisible("defaultPerm") && (
                <SettingItem
                  id="defaultPerm"
                  category="sessions"
                  title="Sessions: Default Permission Mode"
                  description="Permission mode used when creating new sessions."
                  searchQuery={searchQuery}
                >
                  <SelectControl
                    value={defaultPerm}
                    options={permOptions}
                    onChange={updateDefaultPerm}
                  />
                </SettingItem>
              )}

              {isVisible("defaultFolder") && (
                <SettingItem
                  id="defaultFolder"
                  category="sessions"
                  title="Sessions: Default Projects Folder"
                  description="New sessions will create a subfolder here. Leave empty to use the folder picker each time."
                  searchQuery={searchQuery}
                >
                  <div className="sv-browse-row">
                    <input
                      className="sv-text-input"
                      type="text"
                      value={defaultFolder}
                      onChange={(e) => updateDefaultFolder(e.target.value)}
                      placeholder="Not set — will use folder picker"
                      spellCheck={false}
                    />
                    <button className="sv-browse-btn" onClick={handleBrowseFolder} type="button">Browse</button>
                  </div>
                </SettingItem>
              )}

              {isVisible("popOutByDefault") && (
                <SettingItem
                  id="popOutByDefault"
                  category="sessions"
                  title="Sessions: Pop Out By Default"
                  description="Automatically open new and resumed sessions in a separate popout window."
                  searchQuery={searchQuery}
                >
                  <ToggleControl
                    checked={popOutByDefault}
                    onChange={updatePopOutByDefault}
                    label="Enable pop out by default"
                  />
                </SettingItem>
              )}
            </>
          )}

          {/* Window */}
          {(!filteredSettings || visibleCategories.some((c) => c.id === "window")) && (
            <>
              <div className="sv-category-header" data-category-header="window">Window</div>

              {isVisible("minimizeToTray") && (
                <SettingItem
                  id="minimizeToTray"
                  category="window"
                  title="Window: Minimize to Tray"
                  description="Keep the application running in the background when all windows are closed."
                  searchQuery={searchQuery}
                >
                  <ToggleControl
                    checked={minimizeToTray}
                    onChange={updateMinimizeToTray}
                    label="Minimize to system tray on close"
                  />
                </SettingItem>
              )}
            </>
          )}

          {/* About */}
          {(!filteredSettings || visibleCategories.some((c) => c.id === "about")) && (
            <>
              <div className="sv-category-header" data-category-header="about">About</div>
              <div className="sv-about">
                <img className="sv-about-logo" src="../assets/icon-256.png" alt="Buddy Builder" />
                <div className="sv-about-info">
                  <div className="sv-about-name">Buddy Builder</div>
                  <div className="sv-about-version">Version {APP_VERSION}</div>
                  <div className="sv-about-tagline">Your AI pair programming companion</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
