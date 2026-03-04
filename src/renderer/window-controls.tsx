import React, { memo, useCallback } from "react";
import { api } from "./utils.js";

export const WindowControls = memo(function WindowControls() {
  const onMinimize = useCallback(() => api().winMinimize(), []);
  const onMaximize = useCallback(() => api().winMaximize(), []);
  const onClose = useCallback(() => api().winClose(), []);

  return (
    <div className="win-controls">
      <button className="win-btn win-minimize" onClick={onMinimize} aria-label="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button className="win-btn win-maximize" onClick={onMaximize} aria-label="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button className="win-btn win-close" onClick={onClose} aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  );
});
