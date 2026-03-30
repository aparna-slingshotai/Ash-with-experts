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
  idle:       document.getElementById("view-idle"),
  detected:   document.getElementById("view-detected"),
  recording:  document.getElementById("view-recording"),
  processing: document.getElementById("view-processing"),
  context:    document.getElementById("view-context"),
  summary:    document.getElementById("view-summary"),
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
    case "THERAPY_SESSION_ENDED":
      showView("debrief-notify");
      break;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEBRIEF FLOW
// ═══════════════════════════════════════════════════════════════════════════════

const debriefState = {
  startedAt: null,
  mode: null,        // "questionnaire" | "vent"
  ventText: null,
  answers: [],
  insight: null,
  memory: { session: true, answers: true, insight: true },
  questionIndex: 0,
  uploadedFiles: [],
};

// Register debrief views
views["debrief-notify"]       = $("view-debrief-notify");
views["debrief-choose"]       = $("view-debrief-choose");
views["debrief-venting"]      = $("view-debrief-venting");
views["debrief-vent-done"]    = $("view-debrief-vent-done");
views["debrief-questionnaire"] = $("view-debrief-questionnaire");
views["debrief-processing"]   = $("view-debrief-processing");
views["debrief-insight"]      = $("view-debrief-insight");
views["debrief-memory"]       = $("view-debrief-memory");
views["debrief-complete"]     = $("view-debrief-complete");

// ─── Debrief questionnaire data ─────────────────────────────────────────────

const DEBRIEF_QUESTIONS = [
  {
    text: "How are you feeling right now, after the session?",
    type: "options",
    options: ["Lighter", "Heavy", "Confused", "Hopeful", "Numb", "Something else"],
  },
  {
    text: "Did anything your therapist said surprise you or stick with you?",
    type: "freetext",
  },
  {
    text: "Was there something you wanted to say but didn't?",
    type: "options",
    options: ["Yes, there was", "No, I said everything", "I'm not sure"],
  },
  {
    text: "If yes — what was it? If not, what felt most important about today?",
    type: "freetext",
  },
  {
    text: "On a scale of 1-5, how present did you feel during the session?",
    type: "options",
    options: ["1 — Checked out", "2 — Distracted", "3 — In and out", "4 — Mostly present", "5 — Fully there"],
  },
];

// ─── Debrief venting timer ──────────────────────────────────────────────────

let debriefVentTimer = null;
let debriefVentSeconds = 0;

function startDebriefVentTimer() {
  debriefVentSeconds = 0;
  updateDebriefVentDisplay();
  debriefVentTimer = setInterval(() => {
    debriefVentSeconds++;
    updateDebriefVentDisplay();
  }, 1000);
}

function stopDebriefVentTimer() {
  clearInterval(debriefVentTimer);
  debriefVentTimer = null;
}

function updateDebriefVentDisplay() {
  const el = $("debrief-vent-timer");
  if (!el) return;
  const m = String(Math.floor(debriefVentSeconds / 60)).padStart(2, "0");
  const s = String(debriefVentSeconds % 60).padStart(2, "0");
  el.textContent = `${m}:${s}`;
}

// ─── Debrief notification trigger ───────────────────────────────────────────

// Manual entry: add "debrief" to idle view
const idleView = $("view-idle");
if (idleView) {
  const debriefBtn = document.createElement("button");
  debriefBtn.className = "btn-ghost";
  debriefBtn.textContent = "Debrief a session";
  debriefBtn.style.marginTop = "8px";
  debriefBtn.addEventListener("click", () => {
    debriefState.startedAt = Date.now();
    showView("debrief-notify");
  });
  idleView.querySelector(".idle-center").appendChild(debriefBtn);
}

// ─── Button: Start debrief ──────────────────────────────────────────────────

$("btn-debrief-start")?.addEventListener("click", () => {
  debriefState.startedAt = debriefState.startedAt || Date.now();
  showView("debrief-choose");
});

$("btn-debrief-dismiss")?.addEventListener("click", () => {
  showView("idle");
});

// ─── Button: Choose mode ────────────────────────────────────────────────────

$("btn-choose-questionnaire")?.addEventListener("click", () => {
  debriefState.mode = "questionnaire";
  debriefState.questionIndex = 0;
  debriefState.answers = [];
  showView("debrief-questionnaire");
  renderDebriefQuestion();
});

$("btn-choose-vent")?.addEventListener("click", () => {
  debriefState.mode = "vent";
  showView("debrief-venting");
  startDebriefVentTimer();
});

// ─── Venting flow ───────────────────────────────────────────────────────────

$("btn-vent-done")?.addEventListener("click", () => {
  stopDebriefVentTimer();
  showView("debrief-vent-done");
});

// Debrief upload area
const debriefUploadArea = $("debrief-upload-area");
const debriefFileInput = $("debrief-file-input");
const debriefUploadedFilesEl = $("debrief-uploaded-files");

debriefUploadArea?.addEventListener("click", () => debriefFileInput?.click());
debriefUploadArea?.addEventListener("dragover", (e) => {
  e.preventDefault();
  debriefUploadArea.classList.add("drag-over");
});
debriefUploadArea?.addEventListener("dragleave", () => {
  debriefUploadArea.classList.remove("drag-over");
});
debriefUploadArea?.addEventListener("drop", (e) => {
  e.preventDefault();
  debriefUploadArea.classList.remove("drag-over");
  handleDebriefFiles(e.dataTransfer.files);
});
debriefFileInput?.addEventListener("change", (e) => {
  handleDebriefFiles(e.target.files);
  debriefFileInput.value = "";
});

function handleDebriefFiles(fileList) {
  for (const file of fileList) {
    debriefState.uploadedFiles.push(file);
    const pill = document.createElement("div");
    pill.className = "file-pill";
    const icon = getFileIcon(file.type);
    const size = formatFileSize(file.size);
    pill.innerHTML = `
      <span class="file-pill-icon">${icon}</span>
      <span class="file-pill-name">${file.name}</span>
      <span class="file-pill-size">${size}</span>
      <button class="file-pill-remove">&times;</button>
    `;
    pill.querySelector(".file-pill-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      pill.remove();
    });
    debriefUploadedFilesEl?.appendChild(pill);
  }
}

$("btn-vent-continue")?.addEventListener("click", () => {
  // After venting + upload, go to questionnaire
  debriefState.questionIndex = 0;
  debriefState.answers = [];
  showView("debrief-questionnaire");
  renderDebriefQuestion();
});

$("btn-vent-skip-upload")?.addEventListener("click", () => {
  debriefState.questionIndex = 0;
  debriefState.answers = [];
  showView("debrief-questionnaire");
  renderDebriefQuestion();
});

// ─── Questionnaire flow ─────────────────────────────────────────────────────

function renderDebriefQuestion() {
  const q = DEBRIEF_QUESTIONS[debriefState.questionIndex];
  if (!q) {
    // All questions done → processing
    showDebriefProcessing();
    return;
  }

  const convo = $("debrief-q-conversation");
  const optionsEl = $("debrief-q-options");
  const freetextEl = $("debrief-q-freetext");

  // Add question bubble
  const bubble = document.createElement("div");
  bubble.className = "debrief-q-bubble ash";
  bubble.textContent = q.text;
  convo.appendChild(bubble);

  // Scroll to bottom
  const scroll = document.querySelector(".debrief-q-scroll");
  setTimeout(() => scroll.scrollTop = scroll.scrollHeight, 50);

  // Show appropriate input
  optionsEl.innerHTML = "";
  if (q.type === "options") {
    freetextEl.style.display = "none";
    optionsEl.style.display = "flex";
    q.options.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "debrief-q-option-btn";
      btn.textContent = opt;
      btn.addEventListener("click", () => handleDebriefAnswer(opt));
      optionsEl.appendChild(btn);
    });
  } else {
    optionsEl.style.display = "none";
    freetextEl.style.display = "block";
    const input = $("debrief-q-input");
    input.value = "";
    input.focus();
  }
}

function handleDebriefAnswer(answer) {
  const convo = $("debrief-q-conversation");

  // Add user answer bubble
  const bubble = document.createElement("div");
  bubble.className = "debrief-q-bubble user";
  bubble.textContent = answer;
  convo.appendChild(bubble);

  debriefState.answers.push({
    question: DEBRIEF_QUESTIONS[debriefState.questionIndex].text,
    answer: answer,
  });

  debriefState.questionIndex++;

  // Small delay before next question
  setTimeout(() => renderDebriefQuestion(), 600);
}

// Freetext submit
$("btn-debrief-q-send")?.addEventListener("click", () => {
  const input = $("debrief-q-input");
  const val = input.value.trim();
  if (!val) return;
  handleDebriefAnswer(val);
  input.value = "";
});

$("debrief-q-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = e.target.value.trim();
    if (!val) return;
    handleDebriefAnswer(val);
    e.target.value = "";
  }
});

// ─── Debrief processing (fake insight generation) ───────────────────────────

const DEBRIEF_THINKING_PHRASES = [
  "forming insight",
  "connecting the dots",
  "reflecting on your words",
  "finding patterns",
  "understanding context",
];

let debriefThinkingInterval = null;

function showDebriefProcessing() {
  showView("debrief-processing");

  const bar = $("debrief-thinking-bar");
  const phrase = $("debrief-thinking-phrase");
  let progress = 0;
  let phraseIdx = 0;
  bar.style.width = "0%";

  debriefThinkingInterval = setInterval(() => {
    phraseIdx = (phraseIdx + 1) % DEBRIEF_THINKING_PHRASES.length;
    phrase.classList.add("fade-out");
    setTimeout(() => {
      phrase.textContent = DEBRIEF_THINKING_PHRASES[phraseIdx];
      phrase.classList.remove("fade-out");
    }, 300);

    progress = Math.min(progress + 20 + Math.random() * 15, 100);
    bar.style.width = progress + "%";

    if (progress >= 100) {
      clearInterval(debriefThinkingInterval);
      setTimeout(() => {
        showDebriefInsight();
      }, 500);
    }
  }, 1200);
}

// ─── Insight generation (mock) ──────────────────────────────────────────────

function showDebriefInsight() {
  showView("debrief-insight");

  const contentEl = $("debrief-insight-content");
  const psychEl = $("debrief-psych-breakdown");
  const psychContentEl = $("debrief-psych-content");

  contentEl.innerHTML = "";
  psychContentEl.innerHTML = "";

  // Generate mock insights based on answers
  const feeling = debriefState.answers[0]?.answer || "reflective";
  const stuckWith = debriefState.answers[1]?.answer || "";
  const unsaid = debriefState.answers[2]?.answer || "";
  const presence = debriefState.answers[4]?.answer || "";

  const insights = [
    {
      label: "Emotional State",
      text: `You came out of the session feeling "${feeling.toLowerCase()}." This is worth paying attention to — your immediate post-session feeling often signals what your mind is still processing.`,
    },
  ];

  if (stuckWith) {
    insights.push({
      label: "Key Takeaway",
      text: `Something that stuck with you: "${stuckWith}" — Ash will keep track of this for future conversations.`,
    });
  }

  if (unsaid && unsaid.toLowerCase().includes("yes")) {
    insights.push({
      label: "Unspoken",
      text: "You mentioned there was something left unsaid. That's common and important. Consider bringing it up next session, or you can explore it with Ash anytime.",
    });
  }

  insights.forEach(ins => {
    const card = document.createElement("div");
    card.className = "debrief-insight-card";
    card.innerHTML = `
      <div class="debrief-insight-card-label">${ins.label}</div>
      <div class="debrief-insight-card-text">${ins.text}</div>
    `;
    contentEl.appendChild(card);
  });

  debriefState.insight = insights;

  // Psychology breakdown
  const psychTerms = detectPsychTerms(debriefState.answers);
  if (psychTerms.length > 0) {
    psychEl.style.display = "block";
    psychTerms.forEach(term => {
      const el = document.createElement("div");
      el.className = "debrief-psych-term";
      el.innerHTML = `
        <div class="debrief-psych-term-name">${term.name}</div>
        <div class="debrief-psych-term-def">${term.definition}</div>
      `;
      psychContentEl.appendChild(el);
    });
  } else {
    psychEl.style.display = "none";
  }
}

function detectPsychTerms(answers) {
  const terms = [];
  const allText = answers.map(a => a.answer).join(" ").toLowerCase();

  if (allText.includes("numb") || allText.includes("checked out") || allText.includes("distracted")) {
    terms.push({
      name: "Dissociation",
      definition: "A feeling of detachment from your thoughts, feelings, or surroundings. It's your mind's way of protecting you from overwhelm. Mild dissociation during therapy is common.",
    });
  }
  if (allText.includes("heavy") || allText.includes("drained") || allText.includes("exhausted")) {
    terms.push({
      name: "Emotional Processing",
      definition: "Feeling heavy after therapy often means you're doing deep work. Your brain is actively reorganizing how it stores and understands difficult experiences.",
    });
  }
  if (allText.includes("lighter") || allText.includes("hopeful") || allText.includes("relief")) {
    terms.push({
      name: "Catharsis",
      definition: "The release of emotional tension through expression. Feeling lighter is a sign that voicing your experience helped your nervous system settle.",
    });
  }
  if (allText.includes("confused") || allText.includes("not sure")) {
    terms.push({
      name: "Cognitive Restructuring",
      definition: "Confusion after therapy can signal that old thought patterns are being challenged. This is actually progress — your brain is making room for new perspectives.",
    });
  }

  return terms;
}

// ─── Insight → Memory ───────────────────────────────────────────────────────

$("btn-insight-continue")?.addEventListener("click", () => {
  showView("debrief-memory");
});

// ─── Memory toggles ─────────────────────────────────────────────────────────

$("btn-memory-save")?.addEventListener("click", () => {
  debriefState.memory.session = $("mem-session").checked;
  debriefState.memory.answers = $("mem-answers").checked;
  debriefState.memory.insight = $("mem-insight").checked;

  const anyOn = debriefState.memory.session || debriefState.memory.answers || debriefState.memory.insight;

  const titleEl = $("debrief-complete-title");
  const subEl = $("debrief-complete-sub");
  const badgeEl = $("debrief-duration-badge");

  const elapsed = debriefState.startedAt
    ? Math.round((Date.now() - debriefState.startedAt) / 60000 * 10) / 10
    : 0;

  if (anyOn) {
    titleEl.textContent = "I'll remember this";
    subEl.textContent = "I'm gonna remember this for if/when you bring it up in our convo.";
  } else {
    titleEl.textContent = "All good";
    subEl.textContent = "Nothing saved — but you still did the work.";
  }

  badgeEl.textContent = `you debriefed with Ash for ${elapsed < 1 ? "less than a minute" : elapsed.toFixed(1) + " mins"}`;

  showView("debrief-complete");
});

$("btn-memory-none")?.addEventListener("click", () => {
  $("mem-session").checked = false;
  $("mem-answers").checked = false;
  $("mem-insight").checked = false;

  debriefState.memory = { session: false, answers: false, insight: false };

  const elapsed = debriefState.startedAt
    ? Math.round((Date.now() - debriefState.startedAt) / 60000 * 10) / 10
    : 0;

  $("debrief-complete-title").textContent = "All good";
  $("debrief-complete-sub").textContent = "Nothing saved — but you still did the work.";
  $("debrief-duration-badge").textContent = `you debriefed with Ash for ${elapsed < 1 ? "less than a minute" : elapsed.toFixed(1) + " mins"}`;

  showView("debrief-complete");
});

// ─── Complete → back to chat ────────────────────────────────────────────────

$("btn-debrief-to-chat")?.addEventListener("click", () => {
  // Reset debrief state
  debriefState.startedAt = null;
  debriefState.mode = null;
  debriefState.ventText = null;
  debriefState.answers = [];
  debriefState.insight = null;
  debriefState.questionIndex = 0;
  debriefState.uploadedFiles = [];

  // Clear questionnaire conversation
  const convo = $("debrief-q-conversation");
  if (convo) convo.innerHTML = "";

  showView("idle");
});
