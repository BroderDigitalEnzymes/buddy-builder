import React, { useState, useEffect, useCallback } from "react";
import type { PermissionMode } from "../ipc.js";
import { PolicyPicker, PERM_ITEMS } from "./chat-header.js";
import { api } from "./utils.js";

// ─── Settings modal ──────────────────────────────────────────────

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [claudePath, setClaudePath] = useState("");
  const [defaultPerm, setDefaultPerm] = useState<PermissionMode>("default");
  const [defaultFolder, setDefaultFolder] = useState("");
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (open) {
      api().getConfig().then((cfg: any) => {
        setClaudePath(cfg.claudePath);
        setDefaultPerm(cfg.defaultPermissionMode ?? "default");
        setDefaultFolder(cfg.defaultProjectsFolder ?? "");
        setMinimizeToTray(cfg.minimizeToTray ?? true);
      });
      setStatus("");
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    try {
      await api().setConfig({ claudePath, defaultPermissionMode: defaultPerm, defaultProjectsFolder: defaultFolder, minimizeToTray });
      setStatus("Saved. Restart sessions for changes to take effect.");
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }, [claudePath, defaultPerm, defaultFolder, minimizeToTray]);

  const handleBrowseFolder = useCallback(async () => {
    const folder = await api().pickFolder();
    if (folder) setDefaultFolder(folder);
  }, []);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <div className="settings-hero">
          <img className="settings-logo" src="../assets/icon-256.png" alt="Buddy Builder" />
          <div className="settings-brand">Buddy Builder</div>
          <div className="settings-tagline">Your AI pair programming companion</div>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-section-title">Configuration</div>
            <label className="setting-label">
              Claude CLI path
              <input
                className="setting-input"
                type="text"
                value={claudePath}
                onChange={(e) => setClaudePath(e.target.value)}
                placeholder="claude"
                spellCheck={false}
              />
              <span className="setting-hint">
                Command name (e.g. "claude") or full path to executable
              </span>
            </label>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Defaults</div>
            <label className="setting-label">
              Default tool execution policy
              <PolicyPicker items={PERM_ITEMS} value={defaultPerm} onChange={setDefaultPerm} />
            </label>
            <label className="setting-label">
              Default projects folder
              <div className="settings-browse-row">
                <input
                  className="setting-input"
                  type="text"
                  value={defaultFolder}
                  onChange={(e) => setDefaultFolder(e.target.value)}
                  placeholder="Not set — will use folder picker"
                  spellCheck={false}
                />
                <button className="browse-btn" onClick={handleBrowseFolder} type="button">Browse</button>
              </div>
              <span className="setting-hint">
                New sessions create a subfolder here. Leave empty to always use folder picker.
              </span>
            </label>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Behavior</div>
            <label className="setting-label setting-toggle-row">
              <span>
                Minimize to tray
                <span className="setting-hint">Keep running in background when all windows are closed</span>
              </span>
              <button
                type="button"
                className={`setting-toggle-switch${minimizeToTray ? " active" : ""}`}
                onClick={() => setMinimizeToTray(!minimizeToTray)}
                role="switch"
                aria-checked={minimizeToTray}
              >
                <span className="setting-toggle-knob" />
              </button>
            </label>
          </div>
          {status && <div className="setting-status">{status}</div>}
        </div>
        <div className="modal-footer">
          <span className="settings-version">v1.0.0</span>
          <button className="modal-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
