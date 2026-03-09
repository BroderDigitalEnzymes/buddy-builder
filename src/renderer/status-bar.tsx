import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import { getState } from "./store.js";
import { triggerReindex } from "./store-actions.js";

export const StatusBar = memo(function StatusBar() {
  const [showPopup, setShowPopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  const { indexStatus } = getState();

  const handleToggle = useCallback(() => {
    setShowPopup((v) => !v);
  }, []);

  const handleRebuild = useCallback(() => {
    triggerReindex();
    setShowPopup(false);
  }, []);

  // Close popup on outside click
  useEffect(() => {
    if (!showPopup) return;
    function onDown(e: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        itemRef.current &&
        !itemRef.current.contains(e.target as Node)
      ) {
        setShowPopup(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showPopup]);

  const label = indexStatus.isIndexing
    ? `Indexing... ${indexStatus.indexedSessions}/${indexStatus.totalSessions}`
    : `Indexed \u00B7 ${indexStatus.indexedSessions} sessions`;

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <button
          ref={itemRef}
          className={`status-bar-item ${indexStatus.isIndexing ? "indexing" : ""}`}
          onClick={handleToggle}
        >
          {indexStatus.isIndexing && <span className="status-bar-spinner" />}
          <span>{label}</span>
        </button>
      </div>

      {showPopup && (
        <div ref={popupRef} className="status-bar-popup">
          <div className="status-bar-popup-row">
            <span className="status-bar-popup-label">Total sessions</span>
            <span className="status-bar-popup-value">{indexStatus.totalSessions}</span>
          </div>
          <div className="status-bar-popup-row">
            <span className="status-bar-popup-label">Indexed</span>
            <span className="status-bar-popup-value">{indexStatus.indexedSessions}</span>
          </div>
          <div className="status-bar-popup-row">
            <span className="status-bar-popup-label">Status</span>
            <span className="status-bar-popup-value">
              {indexStatus.isIndexing ? "Indexing..." : "Ready"}
            </span>
          </div>
          <button className="status-bar-popup-btn" onClick={handleRebuild}>
            Rebuild Index
          </button>
        </div>
      )}
    </div>
  );
});
