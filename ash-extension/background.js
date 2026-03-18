// ─── Ash with Experts — Background Service Worker ────────────────────────────

const CALL_URL_PATTERNS = [
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/,
  /^https:\/\/.*\.zoom\.us\/j\//,
];

const STATES = { IDLE: "idle", DETECTED: "detected", RECORDING: "recording", PROCESSING: "processing", READY: "ready" };

let sessionState = STATES.IDLE;
let activeTabId = null;

// ── Clicking the extension icon opens the side panel ─────────────────────────
chrome.action.onClicked.addListener((tab) => {
  const isCall = CALL_URL_PATTERNS.some(p => p.test(tab.url));
  if (isCall && sessionState === STATES.IDLE) {
    handleMeetingDetected(tab.id, tab);
  } else {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Tab monitoring ────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  const isCall = CALL_URL_PATTERNS.some(p => p.test(tab.url));
  if (isCall && sessionState === STATES.IDLE) handleMeetingDetected(tabId, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) handleMeetingEnded();
});

// ── Meeting lifecycle ─────────────────────────────────────────────────────────
async function handleMeetingDetected(tabId, tab) {
  sessionState = STATES.DETECTED;
  activeTabId = tabId;
  await chrome.storage.session.set({ sessionState: STATES.DETECTED, activeTabId: tabId, meetingUrl: tab.url, startTime: Date.now() });
  await chrome.sidePanel.open({ tabId });
  broadcastToSidePanel({ type: "MEETING_DETECTED", tabId, url: tab.url });
  chrome.notifications.create("ash-detected", {
    type: "basic", iconUrl: "icons/icon48.png",
    title: "Ash is with you", message: "Session detected.", priority: 0, silent: true,
  });
}

async function handleMeetingEnded() {
  if (sessionState === STATES.IDLE) return;
  sessionState = STATES.PROCESSING;
  await chrome.storage.session.set({ sessionState: STATES.PROCESSING });
  broadcastToSidePanel({ type: "MEETING_ENDED" });
}

// ── Messages ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case "OPEN_SIDE_PANEL":
      // Called from content script when user clicks the pill
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.sidePanel.open({ tabId: tab.id });
      });
      break;

    case "START_RECORDING":
      chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }, (streamId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, streamId });
        }
      });
      return true; // async

    case "RECORDING_STARTED":
      sessionState = STATES.RECORDING;
      chrome.storage.session.set({ sessionState: STATES.RECORDING });
      broadcastToSidePanel({ type: "RECORDING_STARTED" });
      break;

    case "STOP_RECORDING":
      handleMeetingEnded();
      break;

    case "TRANSCRIPT_READY":
      handleTranscriptReady(message.transcript);
      break;

    case "CALL_STARTED_IN_TAB":
      // Content script confirmed user is live in the call
      if (sessionState === STATES.IDLE) {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (tab) handleMeetingDetected(tab.id, tab);
        });
      }
      break;

    case "CALL_ENDED_IN_TAB":
      handleMeetingEnded();
      break;

    case "GET_SESSION_STATE":
      chrome.storage.session.get(null).then(state => sendResponse(state));
      return true;
  }
});

async function handleTranscriptReady(transcript) {
  sessionState = STATES.READY;
  await chrome.storage.session.set({ sessionState: STATES.READY, transcript });
  broadcastToSidePanel({ type: "TRANSCRIPT_READY", transcript });
  chrome.notifications.create("ash-ready", {
    type: "basic", iconUrl: "icons/icon48.png",
    title: "Your session is ready", message: "Ash has processed your session.",
    priority: 2,
  });
}

function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}
