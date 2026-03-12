import React, { memo } from "react";

type WelcomeViewProps = {
  onNewSession: () => void;
  onAdvancedNew?: () => void;
};

export const WelcomeView = memo(function WelcomeView({ onNewSession, onAdvancedNew }: WelcomeViewProps) {
  return (
    <div id="welcome-view">
      <div className="welcome-inner">
        <img className="welcome-logo" src="../assets/icon-256.png" alt="Buddy Builder" />
        <div className="welcome-brand">Buddy Builder</div>
        <div className="welcome-tagline">Your AI pair programming companion</div>
        <div className="welcome-version">v{APP_VERSION}</div>
        <div className="welcome-btn-group">
          <button className="welcome-new-btn" onClick={onNewSession}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 2v12M2 8h12" />
            </svg>
            Start a new session
          </button>
          {onAdvancedNew && (
            <button className="welcome-advanced-btn" onClick={onAdvancedNew} title="Advanced: set system prompt, name, etc.">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="3" cy="4" r="1.5" /><line x1="5" y1="4" x2="15" y2="4" />
                <circle cx="10" cy="8" r="1.5" /><line x1="1" y1="8" x2="8" y2="8" /><line x1="12" y1="8" x2="15" y2="8" />
                <circle cx="6" cy="12" r="1.5" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="8" y1="12" x2="15" y2="12" />
              </svg>
              Advanced
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
