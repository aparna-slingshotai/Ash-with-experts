// ─── Ash with Experts — Side Panel Logic ─────────────────────────────────────
const ASSEMBLYAI_API_KEY = "acb11f85242b4e6a93f2e76bc6b487ba";
const ASH_APP_URL = "http://localhost:3000";

let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let elapsedSeconds = 0;
let transcript = null;
let activeTabId = null;

const views = {
  idle:       document.getElementById("view-idle"),
  detected:   document.getElementById("view-detected"),
  recording:  document.getElementById("view-recording"),
  processing: document.getElementById("view-processing"),
  ready:      document.getElementById("view-ready"),
};

const btnStart      = document.getElementById("btn-start");
const btnDismiss    = document.getElementById("btn-dismiss");
const btnStop       = document.getElementById("btn-stop");
const btnOpenAsh    = document.getElementById("btn-open-ash");
const recTimer      = document.getElementById("rec-timer");
const speakerAssign = document.getElementById("speaker-assign");
const readyActions  = document.getElementById("ready-actions");

// ─── View management ─────────────────────────────────────────────────────────

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
}

// ─── Init: restore state on panel reopen ─────────────────────────────────────

async function init() {
  const state = await chrome.storage.session.get(null);
  if (!state.sessionState || state.sessionState === "idle") {
    showView("idle");
  } else if (state.sessionState === "detected") {
    activeTabId = state.activeTabId;
    showView("detected");
  } else if (state.sessionState === "recording") {
    activeTabId = state.activeTabId;
    elapsedSeconds = state.recordingStartedAt
      ? Math.floor((Date.now() - state.recordingStartedAt) / 1000)
      : 0;
    showView("recording");
    startTimer();
  } else if (state.sessionState === "processing") {
    showView("processing");
  } else if (state.sessionState === "ready") {
    transcript = state.transcript;
    showView("ready");
    populateSpeakerPreviews(transcript);
    // If user already assigned speaker previously, skip selection
    const stored = await chrome.storage.sync.get("userSpeaker");
    if (stored.userSpeaker) {
      speakerAssign.style.display = "none";
      readyActions.style.display = "flex";
    }
  }
}
init();

// ─── Button handlers ─────────────────────────────────────────────────────────

btnStart.addEventListener("click", async () => {
  if (!activeTabId) {
    const s = await chrome.storage.session.get("activeTabId");
    activeTabId = s.activeTabId;
  }
  await startRecording();
});

btnDismiss.addEventListener("click", () => {
  showView("idle");
  chrome.storage.session.set({ sessionState: "idle" });
});

btnStop.addEventListener("click", () => stopRecording());

btnOpenAsh.addEventListener("click", () => {
  chrome.tabs.create({ url: ASH_APP_URL });
});

// ─── Speaker selection ───────────────────────────────────────────────────────

document.querySelectorAll(".speaker-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".speaker-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    const speaker = btn.dataset.speaker;
    await chrome.storage.sync.set({ userSpeaker: speaker });
    await chrome.storage.session.set({ userSpeaker: speaker });

    // Brief delay for visual feedback, then show actions
    setTimeout(() => {
      speakerAssign.style.display = "none";
      readyActions.style.display = "flex";
    }, 200);

    if (transcript) await pushTranscriptToAsh(transcript, speaker);
  });
});

// ─── Recording ───────────────────────────────────────────────────────────────

async function startRecording() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_RECORDING",
      tabId: activeTabId,
    });
    if (!response.success) throw new Error(response.error);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: response.streamId,
        },
      },
      video: false,
    });

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      await handleAudioReady(new Blob(audioChunks, { type: "audio/webm" }));
    };

    mediaRecorder.start(5000); // collect chunks every 5s

    const now = Date.now();
    await chrome.storage.session.set({ recordingStartedAt: now });
    chrome.runtime.sendMessage({ type: "RECORDING_STARTED" });
    showView("recording");
    startTimer();
  } catch (err) {
    console.error("[Ash] Recording failed:", err);
  }
}

function stopRecording() {
  stopTimer();
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  showView("processing");
  chrome.storage.session.set({ sessionState: "processing" });
}

// ─── Timer ───────────────────────────────────────────────────────────────────

function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function updateTimerDisplay() {
  const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const s = String(elapsedSeconds % 60).padStart(2, "0");
  recTimer.textContent = `${m}:${s}`;
}

// ─── Transcription ───────────────────────────────────────────────────────────

async function handleAudioReady(audioBlob) {
  try {
    // Upload audio
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: ASSEMBLYAI_API_KEY },
      body: audioBlob,
    });
    const { upload_url } = await uploadRes.json();

    // Start transcription with speaker diarization
    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        authorization: ASSEMBLYAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,
        speakers_expected: 2,
      }),
    });
    const { id: jobId } = await transcriptRes.json();

    await pollTranscription(jobId);
  } catch (err) {
    console.error("[Ash] Transcription failed:", err);
    showView("idle");
    chrome.storage.session.set({ sessionState: "idle" });
  }
}

async function pollTranscription(jobId) {
  const poll = async () => {
    const res = await fetch(
      `https://api.assemblyai.com/v2/transcript/${jobId}`,
      { headers: { authorization: ASSEMBLYAI_API_KEY } }
    );
    const data = await res.json();

    if (data.status === "completed") {
      transcript = data;
      await chrome.storage.session.set({
        transcript: data,
        sessionState: "ready",
      });
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_READY", transcript: data });
      showView("ready");
      populateSpeakerPreviews(data);

      // Auto-assign if user already selected speaker in a previous session
      const stored = await chrome.storage.sync.get("userSpeaker");
      if (stored.userSpeaker) {
        speakerAssign.style.display = "none";
        readyActions.style.display = "flex";
        await pushTranscriptToAsh(data, stored.userSpeaker);
      }
    } else if (data.status === "error") {
      throw new Error(data.error);
    } else {
      setTimeout(poll, 3000);
    }
  };
  await poll();
}

// ─── Speaker previews ────────────────────────────────────────────────────────

function populateSpeakerPreviews(data) {
  if (!data?.utterances) return;
  const speakers = {};
  data.utterances.forEach(u => {
    if (!speakers[u.speaker]) {
      speakers[u.speaker] = u.text.length > 50
        ? u.text.slice(0, 50) + "…"
        : u.text;
    }
  });
  const pA = document.getElementById("preview-A");
  const pB = document.getElementById("preview-B");
  if (pA) pA.textContent = speakers["A"] || "";
  if (pB) pB.textContent = speakers["B"] || "";
}

// ─── Push to Ash backend ─────────────────────────────────────────────────────

async function pushTranscriptToAsh(data, userSpeaker) {
  try {
    const labeled = data.utterances?.map(u => ({
      speaker: u.speaker === userSpeaker ? "You" : "Therapist",
      text: u.text,
      start: u.start,
      end: u.end,
    }));
    const res = await fetch(`${ASH_APP_URL}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "ash-extension",
        transcript: labeled,
        raw: data.text,
        recordedAt: new Date().toISOString(),
      }),
    });
    const result = await res.json();
    // Store sessionId so "Open in Ash" can link directly
    if (result.sessionId) {
      await chrome.storage.session.set({ ashSessionId: result.sessionId });
    }
  } catch (err) {
    console.error("[Ash] Failed to push transcript:", err);
  }
}

// ─── Messages from background ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "MEETING_DETECTED":
      activeTabId = message.tabId;
      showView("detected");
      break;
    case "MEETING_ENDED":
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        stopRecording();
      }
      break;
    case "RECORDING_STARTED":
      showView("recording");
      startTimer();
      break;
    case "TRANSCRIPT_READY":
      transcript = message.transcript;
      showView("ready");
      populateSpeakerPreviews(message.transcript);
      break;
  }
});
