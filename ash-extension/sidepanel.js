// ─── Ash with Experts — Side Panel Logic ─────────────────────────────────────
const ASSEMBLYAI_API_KEY = "acb11f85242b4e6a93f2e76bc6b487ba";
const ASH_APP_URL = "http://localhost:3000";

let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let elapsedSeconds = 0;
let transcript = null;
let activeTabId = null;
let uploadedFiles = [];
let thinkingInterval = null;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const views = {
  idle:                 document.getElementById("view-idle"),
  detected:             document.getElementById("view-detected"),
  recording:            document.getElementById("view-recording"),
  processing:           document.getElementById("view-processing"),
  context:              document.getElementById("view-context"),
  summary:              document.getElementById("view-summary"),
  "debrief-prompt":     document.getElementById("view-debrief-prompt"),
  "debrief-choice":     document.getElementById("view-debrief-choice"),
  "debrief-questionnaire": document.getElementById("view-debrief-questionnaire"),
  "debrief-vent":       document.getElementById("view-debrief-vent"),
  "debrief-context":    document.getElementById("view-debrief-context"),
  "debrief-processing": document.getElementById("view-debrief-processing"),
  "debrief-qa":         document.getElementById("view-debrief-qa"),
  "debrief-insight":    document.getElementById("view-debrief-insight"),
  "debrief-complete":   document.getElementById("view-debrief-complete"),
};

const $ = (id) => document.getElementById(id);

const btnStart      = $("btn-start");
const btnDismiss    = $("btn-dismiss");
const btnStop       = $("btn-stop");
const btnGenerate   = $("btn-generate");
const btnSkip       = $("btn-skip");
const startError    = $("start-error");
const recTimer      = $("rec-timer");
const chipToggle    = $("chip-toggle");
const chipBody      = $("chip-body");
const chipChevron   = $("chip-chevron");
const chipTranscript = $("chip-transcript");
const chipMeta      = $("chip-meta");
const uploadArea    = $("upload-area");
const fileInput     = $("file-input");
const uploadedFilesEl = $("uploaded-files");
const thinkingPhrase  = $("thinking-phrase");
const thinkingBar     = $("thinking-bar");

// ─── View management ─────────────────────────────────────────────────────────

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
  if (name === "processing") {
    startThinkingAnimation();
    showSkipAfterDelay();
  } else {
    stopThinkingAnimation();
    if (btnSkipProcessing) btnSkipProcessing.style.opacity = "0";
  }
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
  } else if (state.sessionState === "context") {
    transcript = state.transcript;
    showView("context");
    populateContextView(transcript);
  } else if (state.sessionState === "summary") {
    transcript = state.transcript;
    showView("summary");
    populateSummaryView(transcript, state);
  }
}
init();

// ─── Skip processing (demo mode) ─────────────────────────────────────────────

const btnSkipProcessing = $("btn-skip-processing");
// Show skip button after 5 seconds of processing
function showSkipAfterDelay() {
  setTimeout(() => {
    if (btnSkipProcessing) btnSkipProcessing.style.opacity = "1";
  }, 5000);
}

btnSkipProcessing?.addEventListener("click", () => {
  const mock = buildMockTranscript();
  transcript = mock;
  chrome.storage.session.set({ transcript: mock, sessionState: "context" });
  chrome.runtime.sendMessage({ type: "TRANSCRIPT_READY", transcript: mock });
  showView("context");
  populateContextView(mock);
});

function buildMockTranscript() {
  const dur = elapsedSeconds || 300;
  return {
    audio_duration: dur,
    text: "This is a demo transcript. In a real session, Ash would capture and transcribe your full conversation with speaker diarization. The transcript would appear here with each speaker's words clearly separated.",
    utterances: [
      { speaker: "A", text: "How have you been feeling since our last session?", start: 0, end: 5000 },
      { speaker: "B", text: "I've been doing better overall. The breathing exercises have been helping with my anxiety, especially in the mornings.", start: 5500, end: 14000 },
      { speaker: "A", text: "That's great to hear. Can you tell me more about your morning routine now?", start: 15000, end: 20000 },
      { speaker: "B", text: "I wake up, do five minutes of deep breathing before checking my phone. It's made a real difference in how I start my day.", start: 21000, end: 30000 },
      { speaker: "A", text: "That's a really positive change. How about the sleep issues we discussed?", start: 31000, end: 36000 },
      { speaker: "B", text: "Sleep has improved too. I'm falling asleep faster and not waking up as much during the night. Maybe once instead of three or four times.", start: 37000, end: 48000 },
      { speaker: "A", text: "Wonderful progress. Let's talk about what you'd like to focus on going forward.", start: 49000, end: 55000 },
      { speaker: "B", text: "I think I'd like to work on my relationship with my family. There's been some tension and I want to communicate better.", start: 56000, end: 66000 },
    ],
  };
}

// ─── Button handlers ─────────────────────────────────────────────────────────

btnStart.addEventListener("click", async () => {
  startError.style.display = "none";
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

// Demo button: go through processing → context with mock data
$("btn-demo")?.addEventListener("click", () => {
  startError.style.display = "none";
  showView("processing");
  chrome.storage.session.set({ sessionState: "processing" });

  // Brief processing animation (2.5 seconds), then show context dashboard
  let progress = 0;
  const demoInterval = setInterval(() => {
    progress = Math.min(progress + 25, 100);
    thinkingBar.style.width = progress + "%";
    if (progress >= 100) {
      clearInterval(demoInterval);
      setTimeout(() => {
        const mock = buildMockTranscript();
        transcript = mock;
        chrome.storage.session.set({ transcript: mock, sessionState: "context" });
        showView("context");
        populateContextView(mock);
      }, 500);
    }
  }, 500);
});

btnStop.addEventListener("click", () => stopRecording());

btnGenerate.addEventListener("click", () => generateSummary());
btnSkip.addEventListener("click", () => generateSummary());

// ─── Transcript chip expand/collapse ─────────────────────────────────────────

chipToggle.addEventListener("click", () => {
  const isOpen = chipBody.classList.toggle("open");
  chipChevron.classList.toggle("open", isOpen);
});

// ─── Speaker selection (inline) ──────────────────────────────────────────────

document.querySelectorAll(".speaker-pill").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".speaker-pill").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    const speaker = btn.dataset.speaker;
    await chrome.storage.sync.set({ userSpeaker: speaker });
    await chrome.storage.session.set({ userSpeaker: speaker });
  });
});

// ─── File upload ─────────────────────────────────────────────────────────────

uploadArea.addEventListener("click", () => fileInput.click());

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});
uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("drag-over");
});
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener("change", (e) => {
  handleFiles(e.target.files);
  fileInput.value = "";
});

function handleFiles(fileList) {
  for (const file of fileList) {
    uploadedFiles.push(file);
    renderFilePill(file, uploadedFiles.length - 1);
  }
}

function renderFilePill(file, index) {
  const pill = document.createElement("div");
  pill.className = "file-pill";
  pill.dataset.index = index;

  const icon = getFileIcon(file.type);
  const size = formatFileSize(file.size);

  pill.innerHTML = `
    <span class="file-pill-icon">${icon}</span>
    <span class="file-pill-name">${file.name}</span>
    <span class="file-pill-size">${size}</span>
    <button class="file-pill-remove" data-index="${index}">&times;</button>
  `;

  pill.querySelector(".file-pill-remove").addEventListener("click", (e) => {
    e.stopPropagation();
    uploadedFiles[index] = null;
    pill.remove();
  });

  uploadedFilesEl.appendChild(pill);
}

function getFileIcon(mimeType) {
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("doc")) return "📝";
  return "📎";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ─── Recording ───────────────────────────────────────────────────────────────

async function startRecording() {
  try {
    // Use getDisplayMedia — user selects the meeting tab to share audio
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });

    // Only need audio — stop video tracks immediately
    stream.getVideoTracks().forEach(t => t.stop());

    if (stream.getAudioTracks().length === 0) {
      throw new Error("No audio captured. Make sure to share a tab with audio enabled.");
    }

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      await handleAudioReady(new Blob(audioChunks, { type: "audio/webm" }));
    };

    mediaRecorder.start(5000);

    const now = Date.now();
    await chrome.storage.session.set({ recordingStartedAt: now });
    chrome.runtime.sendMessage({ type: "RECORDING_STARTED" });
    showView("recording");
    startTimer();
  } catch (err) {
    console.error("[Ash] Recording failed:", err);
    if (err.name === "NotAllowedError") {
      startError.querySelector(".start-error-text").innerHTML =
        'Recording cancelled. Click <strong>Start Session</strong> again and select the meeting tab to share.';
    } else if (err.name === "NotSupportedError" || err.message?.includes("audio")) {
      startError.querySelector(".start-error-text").innerHTML =
        'Could not access tab audio. Try opening this panel from your <strong>meeting tab</strong>, then click Start Session.';
    } else {
      startError.querySelector(".start-error-text").innerHTML =
        `Could not start recording: ${err.message}`;
    }
    startError.style.display = "block";
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

// ─── Thinking animation ─────────────────────────────────────────────────────

const THINKING_PHRASES = [
  "finding insights",
  "connecting dots",
  "clearing the noise",
  "separating speakers",
  "understanding context",
];

function startThinkingAnimation() {
  let phraseIndex = 0;
  let progress = 0;
  thinkingBar.style.width = "0%";

  thinkingInterval = setInterval(() => {
    phraseIndex = (phraseIndex + 1) % THINKING_PHRASES.length;
    thinkingPhrase.classList.add("fade-out");
    setTimeout(() => {
      thinkingPhrase.textContent = THINKING_PHRASES[phraseIndex];
      thinkingPhrase.classList.remove("fade-out");
    }, 300);

    progress = Math.min(progress + 15 + Math.random() * 10, 90);
    thinkingBar.style.width = progress + "%";
  }, 2500);
}

function stopThinkingAnimation() {
  clearInterval(thinkingInterval);
  thinkingInterval = null;
}

// ─── Transcription ───────────────────────────────────────────────────────────

async function handleAudioReady(audioBlob) {
  try {
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: ASSEMBLYAI_API_KEY },
      body: audioBlob,
    });
    const { upload_url } = await uploadRes.json();

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
      thinkingBar.style.width = "100%";

      await chrome.storage.session.set({
        transcript: data,
        sessionState: "context",
      });
      chrome.runtime.sendMessage({ type: "TRANSCRIPT_READY", transcript: data });

      setTimeout(() => {
        showView("context");
        populateContextView(data);
      }, 600);

      const stored = await chrome.storage.sync.get("userSpeaker");
      if (stored.userSpeaker) {
        const assignEl = $("speaker-assign-inline");
        if (assignEl) assignEl.style.display = "none";
      }
    } else if (data.status === "error") {
      throw new Error(data.error);
    } else {
      setTimeout(poll, 3000);
    }
  };
  await poll();
}

// ─── Context view population ─────────────────────────────────────────────────

function populateContextView(data) {
  if (!data) return;

  // Meta info
  const speakerCount = new Set(data.utterances?.map(u => u.speaker) || []).size;
  const durationMs = data.audio_duration ? data.audio_duration * 1000 : 0;
  const durationMin = Math.round(durationMs / 60000);
  chipMeta.textContent = `${speakerCount} speakers · ${durationMin} min`;

  // Transcript content
  chipTranscript.innerHTML = "";
  if (data.utterances) {
    data.utterances.slice(0, 20).forEach(u => {
      const div = document.createElement("div");
      div.className = "chip-utterance";
      div.innerHTML = `<span class="chip-speaker">Speaker ${u.speaker}</span> ${u.text}`;
      chipTranscript.appendChild(div);
    });
    if (data.utterances.length > 20) {
      const more = document.createElement("div");
      more.className = "chip-utterance";
      more.style.opacity = "0.5";
      more.textContent = `+ ${data.utterances.length - 20} more utterances`;
      chipTranscript.appendChild(more);
    }
  }

  // Auto-select speaker if previously chosen
  chrome.storage.sync.get("userSpeaker").then(stored => {
    if (stored.userSpeaker) {
      const pill = document.querySelector(`.speaker-pill[data-speaker="${stored.userSpeaker}"]`);
      if (pill) pill.classList.add("selected");
      $("speaker-assign-inline").style.display = "none";
    }
  });
}

// ─── Generate summary ────────────────────────────────────────────────────────

async function generateSummary() {
  // Show thinking briefly
  showView("processing");
  thinkingBar.style.width = "0%";

  // Push transcript to Ash backend
  const stored = await chrome.storage.sync.get("userSpeaker");
  if (transcript && stored.userSpeaker) {
    await pushTranscriptToAsh(transcript, stored.userSpeaker);
  }

  // Simulate processing then show summary
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress = Math.min(progress + 20, 100);
    thinkingBar.style.width = progress + "%";
    if (progress >= 100) {
      clearInterval(progressInterval);
      setTimeout(() => {
        chrome.storage.session.set({ sessionState: "summary" });
        chrome.runtime.sendMessage({ type: "SET_STATE", state: "summary" });
        showView("summary");
        populateSummaryView(transcript, {});
      }, 400);
    }
  }, 500);
}

function populateSummaryView(data, state) {
  if (!data) return;

  // EHR fields
  const dateEl = $("ehr-date");
  const durationEl = $("ehr-duration");
  const concernEl = $("ehr-concern");
  const assessmentEl = $("ehr-assessment");
  const planEl = $("ehr-plan");

  const recordedAt = state?.recordingStartedAt
    ? new Date(state.recordingStartedAt)
    : new Date();
  dateEl.textContent = recordedAt.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const durationMin = data.audio_duration
    ? Math.round(data.audio_duration / 60)
    : elapsedSeconds
      ? Math.round(elapsedSeconds / 60)
      : 0;
  durationEl.textContent = `${durationMin} minutes`;

  // Extract first meaningful utterance as chief concern
  const firstUtterance = data.utterances?.[0]?.text || data.text?.slice(0, 120) || "—";
  concernEl.textContent = firstUtterance.length > 100
    ? firstUtterance.slice(0, 100) + "..."
    : firstUtterance;

  assessmentEl.textContent = "Patient engaged in open dialogue. Active participation noted throughout the session.";
  planEl.textContent = "Continue current treatment plan. Follow-up session recommended.";

  // Insights
  const insightsEl = $("insights-content");
  insightsEl.innerHTML = "";

  const insights = extractInsights(data);
  insights.forEach(insight => {
    const block = document.createElement("div");
    block.className = "insight-block";
    block.innerHTML = `
      <div class="insight-label">${insight.label}</div>
      <div class="insight-text">${insight.text}</div>
    `;
    insightsEl.appendChild(block);
  });

  // EHR action handlers
  $("btn-download").addEventListener("click", () => downloadEHR(data, recordedAt, durationMin));
  $("btn-share").addEventListener("click", () => shareEHR());
}

function extractInsights(data) {
  const insights = [];
  const utterances = data.utterances || [];
  const speakers = new Set(utterances.map(u => u.speaker));
  const speakerTimes = {};

  utterances.forEach(u => {
    if (!speakerTimes[u.speaker]) speakerTimes[u.speaker] = 0;
    speakerTimes[u.speaker] += (u.end - u.start);
  });

  insights.push({
    label: "Session Overview",
    text: `${utterances.length} exchanges between ${speakers.size} participants. The conversation covered multiple topics over the course of the session.`,
  });

  if (speakers.size === 2) {
    const [spA, spB] = [...speakers];
    const pctA = Math.round((speakerTimes[spA] / (speakerTimes[spA] + speakerTimes[spB])) * 100);
    insights.push({
      label: "Speaking Balance",
      text: `Speaker ${spA} spoke ${pctA}% of the time, Speaker ${spB} spoke ${100 - pctA}%. ${pctA > 60 ? "One speaker dominated the conversation." : "Balanced dialogue observed."}`,
    });
  }

  if (data.text && data.text.length > 200) {
    const wordCount = data.text.split(/\s+/).length;
    insights.push({
      label: "Content Depth",
      text: `${wordCount} words exchanged. The session covered substantive ground with detailed discussion.`,
    });
  }

  return insights;
}

// ─── EHR download ────────────────────────────────────────────────────────────

function downloadEHR(data, date, duration) {
  const ehrText = [
    "═══════════════════════════════════════════",
    "          ASH WITH EXPERTS — SESSION RECORD",
    "═══════════════════════════════════════════",
    "",
    `Date:           ${date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
    `Duration:       ${duration} minutes`,
    `Session Type:   Individual Therapy`,
    `Chief Concern:  ${$("ehr-concern").textContent}`,
    `Assessment:     ${$("ehr-assessment").textContent}`,
    `Plan:           ${$("ehr-plan").textContent}`,
    "",
    "───────────────────────────────────────────",
    "TRANSCRIPT",
    "───────────────────────────────────────────",
    "",
    ...(data.utterances || []).map(u => `[Speaker ${u.speaker}] ${u.text}`),
    "",
    "═══════════════════════════════════════════",
    "Generated by Ash with Experts",
  ].join("\n");

  const blob = new Blob([ehrText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ash-session-${date.toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function shareEHR() {
  // Placeholder — could open email compose or share sheet
  const email = prompt("Enter provider's email address:");
  if (email) {
    alert(`Sharing session record with ${email}.\n\n(This feature will be fully implemented with the Ash backend.)`);
  }
}

// ─── Prompt chips ────────────────────────────────────────────────────────────

document.querySelectorAll(".prompt-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const input = $("user-question");
    input.value = chip.dataset.prompt;
    input.focus();
  });
});

$("btn-ask")?.addEventListener("click", handleUserQuestion);
$("user-question")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleUserQuestion();
});

function handleUserQuestion() {
  const input = $("user-question");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  // Placeholder — would send to AI backend
  alert(`Ash received your question:\n"${question}"\n\n(AI responses will be implemented with the Ash backend.)`);
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
      showView("context");
      populateContextView(message.transcript);
      break;
    case "DEBRIEF_PROMPT":
      showView("debrief-prompt");
      break;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── DEBRIEF FLOW ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

let ventRecorder = null;
let ventAudioChunks = [];
let ventAudioBlob = null;
let ventAudioUrl = null;
let ventTimerInterval = null;
let ventElapsedSeconds = 0;
let debriefStartTime = null;
let debriefQuestionnaireAnswers = {};
let debriefQAHistory = [];
let debriefInsight = null;
let debriefUploadedFiles = [];
let ventTranscriptText = "";

// ─── Debrief DOM refs ───────────────────────────────────────────────────────

const btnDebriefManual  = $("btn-debrief-manual");
const btnDebriefYes     = $("btn-debrief-yes");
const btnDebriefDismiss = $("btn-debrief-dismiss");
const btnChoiceVent     = $("btn-choice-vent");
const btnChoiceQ        = $("btn-choice-questionnaire");
const btnQDone          = $("btn-q-done");
const btnVentDone       = $("btn-vent-done");
const btnDebriefContinue = $("btn-debrief-continue");
const btnDebriefSkipCtx  = $("btn-debrief-skip-ctx");
const btnDebriefFinish   = $("btn-debrief-finish");
const ventTimerEl        = $("vent-timer");

// ─── Pre-vent questionnaire data ────────────────────────────────────────────

const DEBRIEF_QUESTIONS = [
  {
    id: "mood",
    label: "How are you feeling right now?",
    options: ["Lighter", "Heavy", "Mixed", "Numb", "Energized", "Unsure"],
  },
  {
    id: "session-feel",
    label: "How did the session feel?",
    options: ["Productive", "Difficult", "Eye-opening", "Frustrating", "Comforting", "Confusing"],
  },
  {
    id: "lingering",
    label: "Is anything still lingering?",
    options: ["Something they said", "A feeling I can't name", "A memory that came up", "Nothing specific", "Everything"],
  },
];

// ─── Entry points ───────────────────────────────────────────────────────────

btnDebriefManual.addEventListener("click", () => {
  debriefStartTime = Date.now();
  showView("debrief-choice");
});

btnDebriefYes.addEventListener("click", () => {
  debriefStartTime = Date.now();
  showView("debrief-choice");
});

btnDebriefDismiss.addEventListener("click", () => {
  showView("idle");
  chrome.storage.session.set({ sessionState: "idle" });
});

// ─── Choice: vent or questionnaire first ────────────────────────────────────

btnChoiceVent.addEventListener("click", () => {
  startVentRecording();
});

btnChoiceQ.addEventListener("click", () => {
  renderQuestionnaire();
  showView("debrief-questionnaire");
});

// ─── Pre-vent questionnaire ─────────────────────────────────────────────────

function renderQuestionnaire() {
  const container = $("debrief-q-container");
  container.innerHTML = "";
  debriefQuestionnaireAnswers = {};

  DEBRIEF_QUESTIONS.forEach(q => {
    const item = document.createElement("div");
    item.className = "debrief-q-item";

    const label = document.createElement("div");
    label.className = "debrief-q-label";
    label.textContent = q.label;
    item.appendChild(label);

    const options = document.createElement("div");
    options.className = "debrief-q-options";

    q.options.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "debrief-q-option";
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        options.querySelectorAll(".debrief-q-option").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        debriefQuestionnaireAnswers[q.id] = opt;
      });
      options.appendChild(btn);
    });

    item.appendChild(options);
    container.appendChild(item);
  });
}

btnQDone.addEventListener("click", () => {
  startVentRecording();
});

// ─── Vent recording (voice memo) ────────────────────────────────────────────

async function startVentRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    ventAudioChunks = [];
    ventRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    ventRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) ventAudioChunks.push(e.data);
    };

    ventRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      ventAudioBlob = new Blob(ventAudioChunks, { type: "audio/webm" });
      ventAudioUrl = URL.createObjectURL(ventAudioBlob);
      onVentComplete();
    };

    ventRecorder.start(1000);
    ventElapsedSeconds = 0;
    showView("debrief-vent");
    startVentTimer();
  } catch (err) {
    console.error("[Ash] Vent recording failed:", err);
  }
}

function startVentTimer() {
  updateVentTimerDisplay();
  ventTimerInterval = setInterval(() => {
    ventElapsedSeconds++;
    updateVentTimerDisplay();
  }, 1000);
}

function stopVentTimer() {
  clearInterval(ventTimerInterval);
}

function updateVentTimerDisplay() {
  const m = String(Math.floor(ventElapsedSeconds / 60)).padStart(2, "0");
  const s = String(ventElapsedSeconds % 60).padStart(2, "0");
  ventTimerEl.textContent = `${m}:${s}`;
}

btnVentDone.addEventListener("click", () => {
  stopVentTimer();
  if (ventRecorder && ventRecorder.state !== "inactive") {
    ventRecorder.stop();
  }
});

// ─── Vent complete → context view ───────────────────────────────────────────

function onVentComplete() {
  renderVoiceNote(
    $("vent-voice-note"), $("vent-wave-bars"), $("vent-duration"), $("btn-vent-play"),
    $("vent-transcript-text"), $("vent-transcript-toggle")
  );
  showView("debrief-context");

  // Wire up debrief upload area
  const debriefUploadArea = $("debrief-upload-area");
  const debriefFileInput = $("debrief-file-input");
  const debriefUploadedFilesEl = $("debrief-uploaded-files");

  debriefUploadArea.addEventListener("click", () => debriefFileInput.click());
  debriefUploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    debriefUploadArea.classList.add("drag-over");
  });
  debriefUploadArea.addEventListener("dragleave", () => {
    debriefUploadArea.classList.remove("drag-over");
  });
  debriefUploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    debriefUploadArea.classList.remove("drag-over");
    handleDebriefFiles(e.dataTransfer.files, debriefUploadedFilesEl);
  });
  debriefFileInput.addEventListener("change", (e) => {
    handleDebriefFiles(e.target.files, debriefUploadedFilesEl);
    debriefFileInput.value = "";
  });
}

function handleDebriefFiles(fileList, container) {
  for (const file of fileList) {
    debriefUploadedFiles.push(file);
    renderFilePill(file, debriefUploadedFiles.length - 1);
    // Append to the debrief container instead
    const pill = container.parentElement.querySelector(`.file-pill[data-index="${debriefUploadedFiles.length - 1}"]`);
    if (pill) container.appendChild(pill);
  }
}

// ─── Voice note renderer ────────────────────────────────────────────────────

function renderVoiceNote(noteEl, waveEl, durationEl, playBtn, transcriptTextEl, transcriptToggleEl) {
  // Generate random wave bars
  waveEl.innerHTML = "";
  const barCount = 30;
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement("div");
    bar.className = "wave-bar";
    bar.style.height = (4 + Math.random() * 18) + "px";
    waveEl.appendChild(bar);
  }

  // Duration
  const mins = Math.floor(ventElapsedSeconds / 60);
  const secs = ventElapsedSeconds % 60;
  durationEl.textContent = `${mins}:${String(secs).padStart(2, "0")}`;

  // Play/pause
  let audio = null;
  let isPlaying = false;

  playBtn.addEventListener("click", () => {
    if (!ventAudioUrl) return;

    if (!audio) {
      audio = new Audio(ventAudioUrl);
      audio.addEventListener("ended", () => {
        isPlaying = false;
        playBtn.textContent = "▶";
        playBtn.classList.remove("playing");
        // Reset wave bars
        waveEl.querySelectorAll(".wave-bar").forEach(b => b.classList.remove("played"));
      });

      audio.addEventListener("timeupdate", () => {
        const pct = audio.currentTime / audio.duration;
        const bars = waveEl.querySelectorAll(".wave-bar");
        bars.forEach((b, i) => {
          b.classList.toggle("played", i / bars.length < pct);
        });
      });
    }

    if (isPlaying) {
      audio.pause();
      isPlaying = false;
      playBtn.textContent = "▶";
      playBtn.classList.remove("playing");
    } else {
      audio.play();
      isPlaying = true;
      playBtn.textContent = "❚❚";
      playBtn.classList.add("playing");
    }
  });

  // Transcript expand/collapse
  if (transcriptTextEl && transcriptToggleEl && ventTranscriptText) {
    transcriptTextEl.textContent = ventTranscriptText;
    transcriptToggleEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = transcriptTextEl.classList.toggle("expanded");
      transcriptToggleEl.textContent = isExpanded ? "Show less" : "Read more";
    });
  } else if (transcriptTextEl && !ventTranscriptText) {
    // Hide transcript area if no transcript yet
    transcriptTextEl.parentElement.style.display = "none";
  }
}

// ─── Continue to Ash Q&A ────────────────────────────────────────────────────

btnDebriefContinue.addEventListener("click", () => startDebriefQA());
btnDebriefSkipCtx.addEventListener("click", () => startDebriefQA());

async function startDebriefQA() {
  showView("debrief-processing");

  // Animate processing
  const bar = $("debrief-thinking-bar");
  const phrase = $("debrief-thinking-phrase");
  bar.style.width = "0%";

  const phrases = [
    "reflecting on what you shared",
    "finding the right questions",
    "connecting the pieces",
    "preparing your debrief",
  ];
  let phraseIdx = 0;
  let progress = 0;

  const processingInterval = setInterval(() => {
    phraseIdx = (phraseIdx + 1) % phrases.length;
    phrase.classList.add("fade-out");
    setTimeout(() => {
      phrase.textContent = phrases[phraseIdx];
      phrase.classList.remove("fade-out");
    }, 300);
    progress = Math.min(progress + 20 + Math.random() * 10, 90);
    bar.style.width = progress + "%";
  }, 2000);

  try {
    // Transcribe the vent audio first
    let ventTranscript = "";
    if (ventAudioBlob) {
      ventTranscript = await transcribeVentAudio(ventAudioBlob);
    }

    // Store transcript text for voice note display
    ventTranscriptText = ventTranscript;

    // Update transcript preview if already rendered
    const ventTextEl = $("vent-transcript-text");
    if (ventTextEl && ventTranscript) {
      ventTextEl.textContent = ventTranscript;
      ventTextEl.parentElement.style.display = "";
    }

    // Call backend to generate debrief questions
    const res = await fetch(`${ASH_APP_URL}/api/debrief/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ventTranscript,
        questionnaireAnswers: debriefQuestionnaireAnswers,
      }),
    });
    const data = await res.json();

    clearInterval(processingInterval);
    bar.style.width = "100%";

    setTimeout(() => {
      showView("debrief-qa");
      startQAConversation(data.questions || [], data.debriefId);
    }, 500);
  } catch (err) {
    console.error("[Ash] Debrief QA start failed:", err);
    clearInterval(processingInterval);
    bar.style.width = "100%";

    // Fallback: use default questions
    setTimeout(() => {
      showView("debrief-qa");
      startQAConversation([
        "What felt most important about what you just shared?",
        "Was there a moment in the session that surprised you?",
        "How does what came up connect to your day-to-day life?",
      ], null);
    }, 500);
  }
}

async function transcribeVentAudio(blob) {
  try {
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: ASSEMBLYAI_API_KEY },
      body: blob,
    });
    const { upload_url } = await uploadRes.json();

    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        authorization: ASSEMBLYAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    const { id: jobId } = await transcriptRes.json();

    // Poll
    while (true) {
      const res = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
        headers: { authorization: ASSEMBLYAI_API_KEY },
      });
      const data = await res.json();
      if (data.status === "completed") return data.text || "";
      if (data.status === "error") throw new Error(data.error);
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error("[Ash] Vent transcription failed:", err);
    return "";
  }
}

// ─── Q&A Conversation ───────────────────────────────────────────────────────

let qaQuestions = [];
let qaQuestionIndex = 0;
let qaDebriefId = null;

function startQAConversation(questions, debriefId) {
  qaQuestions = questions;
  qaQuestionIndex = 0;
  qaDebriefId = debriefId;
  debriefQAHistory = [];

  const thread = $("debrief-qa-thread");
  thread.innerHTML = "";

  // Ask first question
  if (qaQuestions.length > 0) {
    appendQABubble("ash", qaQuestions[0]);
    debriefQAHistory.push({ role: "ash", content: qaQuestions[0] });
  }
}

function appendQABubble(role, text) {
  const thread = $("debrief-qa-thread");
  const bubble = document.createElement("div");
  bubble.className = `qa-bubble ${role}`;
  bubble.textContent = text;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;

  // Check for psychology terms and add breakdown
  if (role === "ash") {
    const terms = detectPsychTerms(text);
    terms.forEach(term => {
      const termEl = document.createElement("span");
      termEl.className = "psych-term";
      termEl.textContent = term.name;
      termEl.title = term.definition;
      bubble.appendChild(termEl);
    });
  }
}

function showTypingIndicator() {
  const thread = $("debrief-qa-thread");
  const typing = document.createElement("div");
  typing.className = "qa-typing";
  typing.id = "qa-typing-indicator";
  typing.innerHTML = "<span></span><span></span><span></span>";
  thread.appendChild(typing);
  thread.scrollTop = thread.scrollHeight;
}

function removeTypingIndicator() {
  const el = $("qa-typing-indicator");
  if (el) el.remove();
}

const PSYCH_TERMS_MAP = {
  "cognitive distortion": "A pattern of thinking that's biased or inaccurate, often reinforcing negative thoughts.",
  "catastrophizing": "Assuming the worst possible outcome will happen, even when it's unlikely.",
  "rumination": "Repetitively going over the same thoughts, usually negative, without reaching a resolution.",
  "emotional regulation": "The ability to manage and respond to emotional experiences in a healthy way.",
  "attachment style": "Patterns in how you relate to others in close relationships, often shaped early in life.",
  "boundaries": "Limits you set to protect your emotional and mental well-being in relationships.",
  "projection": "Attributing your own feelings or thoughts to someone else.",
  "dissociation": "Feeling disconnected from your thoughts, feelings, or surroundings as a coping mechanism.",
  "hypervigilance": "Being in a constant state of alertness, often linked to anxiety or past trauma.",
  "inner critic": "The internal voice that judges and criticizes you, often more harshly than warranted.",
};

function detectPsychTerms(text) {
  const found = [];
  const lower = text.toLowerCase();
  for (const [term, definition] of Object.entries(PSYCH_TERMS_MAP)) {
    if (lower.includes(term)) {
      found.push({ name: term, definition });
    }
  }
  return found;
}

// Q&A input handling
$("btn-debrief-qa-send").addEventListener("click", handleQAInput);
$("debrief-qa-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleQAInput();
});

async function handleQAInput() {
  const input = $("debrief-qa-input");
  const answer = input.value.trim();
  if (!answer) return;
  input.value = "";

  appendQABubble("user", answer);
  debriefQAHistory.push({ role: "user", content: answer });
  qaQuestionIndex++;

  if (qaQuestionIndex < qaQuestions.length) {
    // Ask next question
    showTypingIndicator();
    await new Promise(r => setTimeout(r, 800 + Math.random() * 600));
    removeTypingIndicator();
    appendQABubble("ash", qaQuestions[qaQuestionIndex]);
    debriefQAHistory.push({ role: "ash", content: qaQuestions[qaQuestionIndex] });
  } else {
    // All questions answered — generate insight
    showTypingIndicator();
    await generateDebriefInsight();
  }
}

// ─── Insight generation ─────────────────────────────────────────────────────

async function generateDebriefInsight() {
  try {
    const res = await fetch(`${ASH_APP_URL}/api/debrief/insight`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        debriefId: qaDebriefId,
        qaHistory: debriefQAHistory,
        questionnaireAnswers: debriefQuestionnaireAnswers,
      }),
    });
    const data = await res.json();
    removeTypingIndicator();
    debriefInsight = data.insight;
    showInsightView(data.insight);
  } catch (err) {
    console.error("[Ash] Insight generation failed:", err);
    removeTypingIndicator();
    // Fallback insight
    const fallback = {
      summary: "Based on what you shared, it sounds like this session brought up some important threads worth sitting with.",
      highlight: "The way you described your experience suggests you're becoming more aware of your patterns — that's meaningful progress.",
    };
    debriefInsight = fallback;
    showInsightView(fallback);
  }
}

function showInsightView(insight) {
  const content = $("debrief-insight-content");
  content.innerHTML = `
    <p>${insight.summary || insight}</p>
    ${insight.highlight ? `<div class="insight-highlight">${insight.highlight}</div>` : ""}
  `;
  showView("debrief-insight");
}

// ─── Memory consent + finish ────────────────────────────────────────────────

btnDebriefFinish.addEventListener("click", async () => {
  const rememberDebrief  = $("mem-debrief").checked;
  const rememberAnswers  = $("mem-answers").checked;
  const rememberInsight  = $("mem-insight").checked;

  const debriefDuration = debriefStartTime
    ? Math.round((Date.now() - debriefStartTime) / 60000 * 10) / 10
    : 0;

  // Save to backend
  try {
    await fetch(`${ASH_APP_URL}/api/debrief/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        debriefId: qaDebriefId,
        remember: { debrief: rememberDebrief, answers: rememberAnswers, insight: rememberInsight },
        qaHistory: rememberAnswers ? debriefQAHistory : [],
        insight: rememberInsight ? debriefInsight : null,
        questionnaireAnswers: debriefQuestionnaireAnswers,
        durationMinutes: debriefDuration,
      }),
    });
  } catch (err) {
    console.error("[Ash] Failed to save debrief:", err);
  }

  // Show complete view
  showView("debrief-complete");

  // Render voice note in complete view
  renderVoiceNote(
    $("complete-voice-note"),
    $("complete-wave-bars"),
    $("complete-duration"),
    $("btn-complete-play"),
    $("complete-transcript-text"),
    $("complete-transcript-toggle")
  );

  // Set hairline text
  $("debrief-hairline").textContent = `you debriefed with Ash for ${debriefDuration} mins`;

  // Show Ash's closing message
  const ashMsg = $("debrief-ash-response");
  if (rememberDebrief || rememberAnswers || rememberInsight) {
    ashMsg.textContent = "I'm gonna remember this for if/when you bring it up in our convo.";
  } else {
    ashMsg.textContent = "No worries — this stays between us for now. I'm here whenever you want to talk.";
  }
});
