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
        "Recording cancelled. Click <strong>Start Session</strong> again and select the meeting tab to share.";
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
  }
});
