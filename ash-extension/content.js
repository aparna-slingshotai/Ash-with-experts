// ─── Ash with Experts — Content Script ───────────────────────────────────────
// Injects the stowed pill widget directly into the Meet/Zoom tab.
// The pill lives on the right edge — clicking it opens the Chrome side panel.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  if (document.getElementById("ash-pill")) return; // prevent double inject

  let callActive = false;

  // ── Inject styles ───────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #ash-pill {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 44px;
      padding: 14px 0;
      background: rgba(22, 22, 22, 0.92);
      border-radius: 14px 0 0 14px;
      border: 1px solid rgba(255,255,255,0.07);
      border-right: none;
      backdrop-filter: blur(12px);
      cursor: pointer;
      transition: width 0.2s ease, background 0.2s ease, opacity 0.3s ease;
      box-shadow: -4px 0 24px rgba(0,0,0,0.4);
      opacity: 0;
      pointer-events: none;
    }
    #ash-pill.visible {
      opacity: 1;
      pointer-events: all;
    }
    #ash-pill:hover {
      background: rgba(30, 30, 30, 0.97);
      width: 48px;
    }
    #ash-pill-logo {
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #c9a96e;
      font-size: 18px;
      line-height: 1;
      transition: color 0.2s ease;
    }
    #ash-pill.recording #ash-pill-logo {
      color: #e05a4e;
      animation: ash-pulse-logo 2s ease-in-out infinite;
    }
    @keyframes ash-pulse-logo {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    #ash-pill-bars {
      display: flex;
      align-items: center;
      gap: 2px;
      height: 16px;
    }
    #ash-pill-bars span {
      display: block;
      width: 2.5px;
      border-radius: 2px;
      background: rgba(255,255,255,0.2);
      transition: background 0.2s ease;
    }
    #ash-pill.recording #ash-pill-bars span {
      background: #4caf72;
    }
    #ash-pill.recording #ash-pill-bars span:nth-child(1) {
      animation: ash-bar 1.1s ease-in-out infinite 0s;
    }
    #ash-pill.recording #ash-pill-bars span:nth-child(2) {
      animation: ash-bar 1.1s ease-in-out infinite 0.18s;
    }
    #ash-pill.recording #ash-pill-bars span:nth-child(3) {
      animation: ash-bar 1.1s ease-in-out infinite 0.36s;
    }
    @keyframes ash-bar {
      0%, 100% { height: 4px; opacity: 0.4; }
      50%       { height: 14px; opacity: 1; }
    }
    #ash-pill-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #4caf72;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    #ash-pill.recording #ash-pill-dot {
      opacity: 1;
      animation: ash-dot-blink 1.2s step-end infinite;
    }
    @keyframes ash-dot-blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0; }
    }
    #ash-pill-tooltip {
      position: absolute;
      right: 52px;
      background: rgba(15,15,15,0.95);
      color: #c9a96e;
      font-family: system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.03em;
      white-space: nowrap;
      padding: 5px 10px;
      border-radius: 6px;
      border: 1px solid rgba(201, 169, 110, 0.2);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    #ash-pill:hover #ash-pill-tooltip {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);

  // ── Build pill DOM ──────────────────────────────────────────────────────────
  const pill = document.createElement("div");
  pill.id = "ash-pill";
  pill.innerHTML = `
    <div id="ash-pill-logo">✦</div>
    <div id="ash-pill-bars">
      <span style="height:4px"></span>
      <span style="height:8px"></span>
      <span style="height:4px"></span>
    </div>
    <div id="ash-pill-dot"></div>
    <div id="ash-pill-tooltip">Open Ash</div>
  `;
  document.body.appendChild(pill);

  // ── Pill click → open side panel ────────────────────────────────────────────
  pill.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
  });

  // ── Call detection ──────────────────────────────────────────────────────────
  function detectMeetCallState() {
    const leaveBtn = document.querySelector('[aria-label="Leave call"], [data-tooltip="Leave call"]');
    const isInCall = !!leaveBtn;
    if (isInCall && !callActive) { callActive = true; onCallStarted(); }
    else if (!isInCall && callActive) { callActive = false; onCallEnded(); }
  }

  function detectZoomCallState() {
    const toolbar = document.querySelector(".footer-toolbar, #wc-footer");
    const isInCall = !!toolbar;
    if (isInCall && !callActive) { callActive = true; onCallStarted(); }
    else if (!isInCall && callActive) { callActive = false; onCallEnded(); }
  }

  function detectCallState() {
    if (window.location.hostname === "meet.google.com") detectMeetCallState();
    else if (window.location.hostname.includes("zoom.us")) detectZoomCallState();
  }

  // ── Call lifecycle ──────────────────────────────────────────────────────────
  function onCallStarted() {
    chrome.runtime.sendMessage({ type: "CALL_STARTED_IN_TAB" });
    pill.classList.add("visible");
    updateTooltip("Session detected — click to open Ash");
  }

  function onCallEnded() {
    chrome.runtime.sendMessage({ type: "CALL_ENDED_IN_TAB" });
    pill.classList.remove("visible", "recording");
  }

  function updateTooltip(text) {
    const t = document.getElementById("ash-pill-tooltip");
    if (t) t.textContent = text;
  }

  // ── Messages from background ─────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case "RECORDING_STARTED":
        pill.classList.add("recording");
        updateTooltip("Recording in progress");
        break;
      case "MEETING_ENDED":
        pill.classList.remove("recording");
        updateTooltip("Processing session…");
        break;
      case "TRANSCRIPT_READY":
        pill.classList.remove("recording");
        updateTooltip("Your session is ready");
        break;
    }
  });

  // ── Observe DOM ─────────────────────────────────────────────────────────────
  const observer = new MutationObserver(() => detectCallState());
  observer.observe(document.body, { childList: true, subtree: true });
  detectCallState();
})();
