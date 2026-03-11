import React, { memo } from "react";

type WelcomeViewProps = {
  onNewSession: () => void;
};

export const WelcomeView = memo(function WelcomeView({ onNewSession }: WelcomeViewProps) {
  return (
    <div id="welcome-view">
      <div className="welcome-inner">
        <img className="welcome-logo" src="../assets/icon-256.png" alt="Buddy Builder" />
        <div className="welcome-brand">Buddy Builder</div>
        <div className="welcome-tagline">Your AI pair programming companion</div>
        <div className="welcome-version">v{APP_VERSION}</div>
        <button className="welcome-new-btn" onClick={onNewSession}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 2v12M2 8h12" />
          </svg>
          Start a new session
        </button>
      </div>
    </div>
  );
});
