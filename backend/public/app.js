// ─── Ash — Debrief Web App ──────────────────────────────────────────────────
const API = window.location.origin;
const ASSEMBLYAI_KEY = "acb11f85242b4e6a93f2e76bc6b487ba";

// ─── State ──────────────────────────────────────────────────────────────────
let ventRecorder = null;
let ventChunks = [];
let ventBlob = null;
let ventUrl = null;
let ventTranscriptText = "";
let ventSeconds = 0;
let ventTimer = null;
let debriefStart = null;
let qAnswers = {};
let qaHistory = [];
let qaQuestions = [];
let qaIndex = 0;
let qaDebriefId = null;
let currentInsight = null;
let uploadedFiles = [];

// ─── DOM helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const VIEWS = [
  "home", "debrief-prompt", "debrief-choice", "debrief-questionnaire",
  "vent", "vent-context", "processing", "qa", "insight", "complete",
];

function showView(name) {
  VIEWS.forEach(v => {
    const el = $(`view-${v}`);
    if (el) el.classList.toggle("active", v === name);
  });
}

// ─── Pre-vent questionnaire data ────────────────────────────────────────────
const QUESTIONS = [
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

// ─── Psychology terms ───────────────────────────────────────────────────────
const PSYCH_TERMS = {
  "cognitive distortion": "A pattern of thinking that's biased or inaccurate, often reinforcing negative thoughts.",
  "catastrophizing": "Assuming the worst possible outcome will happen, even when it's unlikely.",
  "rumination": "Repetitively going over the same thoughts, usually negative, without reaching resolution.",
  "emotional regulation": "The ability to manage and respond to emotional experiences in a healthy way.",
  "attachment style": "Patterns in how you relate to others in close relationships, shaped early in life.",
  "boundaries": "Limits you set to protect your emotional and mental well-being in relationships.",
  "projection": "Attributing your own feelings or thoughts to someone else.",
  "dissociation": "Feeling disconnected from your thoughts, feelings, or surroundings as a coping mechanism.",
  "hypervigilance": "Being in a constant state of alertness, often linked to anxiety or past trauma.",
  "inner critic": "The internal voice that judges and criticizes you, often more harshly than warranted.",
};

function detectTerms(text) {
  const found = [];
  const lower = text.toLowerCase();
  for (const [term, def] of Object.entries(PSYCH_TERMS)) {
    if (lower.includes(term)) found.push({ term, def });
  }
  return found;
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── NAVIGATION ─────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

// Home → debrief
$("btn-debrief").addEventListener("click", () => {
  debriefStart = Date.now();
  showView("debrief-choice");
});

// Debrief prompt (if used)
$("btn-debrief-yes")?.addEventListener("click", () => {
  debriefStart = Date.now();
  showView("debrief-choice");
});
$("btn-debrief-dismiss")?.addEventListener("click", () => showView("home"));

// Back buttons
$("btn-back-choice")?.addEventListener("click", () => showView("home"));
$("btn-back-q")?.addEventListener("click", () => showView("debrief-choice"));

// Choice
$("btn-choice-vent").addEventListener("click", () => startVent());
$("btn-choice-questionnaire").addEventListener("click", () => {
  renderQuestionnaire();
  showView("debrief-questionnaire");
});

// Questionnaire done → vent
$("btn-q-done").addEventListener("click", () => startVent());

// Vent done
$("btn-vent-done").addEventListener("click", () => stopVent());

// Post-vent context
$("btn-ctx-continue").addEventListener("click", () => beginQA());
$("btn-ctx-skip").addEventListener("click", () => beginQA());

// QA send
$("btn-qa-send").addEventListener("click", handleQASend);
$("qa-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQASend(); } });

// Finish
$("btn-finish").addEventListener("click", finishDebrief);

// Chat send (complete view)
$("btn-chat-send").addEventListener("click", handleChatSend);
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } });

// Upload
$("upload-area").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  addFiles(e.target.files);
  $("file-input").value = "";
});
$("upload-area").addEventListener("dragover", (e) => e.preventDefault());
$("upload-area").addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

// ═════════════════════════════════════════════════════════════════════════════
// ─── QUESTIONNAIRE ──────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function renderQuestionnaire() {
  const container = $("q-container");
  container.innerHTML = "";
  qAnswers = {};

  QUESTIONS.forEach(q => {
    const item = document.createElement("div");
    item.className = "q-item";

    const label = document.createElement("div");
    label.className = "q-label";
    label.textContent = q.label;
    item.appendChild(label);

    const opts = document.createElement("div");
    opts.className = "q-options";

    q.options.forEach(opt => {
      const pill = document.createElement("button");
      pill.className = "q-pill";
      pill.textContent = opt;
      pill.addEventListener("click", () => {
        opts.querySelectorAll(".q-pill").forEach(p => p.classList.remove("selected"));
        pill.classList.add("selected");
        qAnswers[q.id] = opt;
      });
      opts.appendChild(pill);
    });

    item.appendChild(opts);
    container.appendChild(item);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── VENT RECORDING ─────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

async function startVent() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    ventChunks = [];
    ventRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
    });

    ventRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) ventChunks.push(e.data);
    };

    ventRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      ventBlob = new Blob(ventChunks, { type: ventRecorder.mimeType });
      ventUrl = URL.createObjectURL(ventBlob);
      onVentDone();
    };

    ventRecorder.start(1000);
    ventSeconds = 0;
    showView("vent");
    ventTimer = setInterval(() => {
      ventSeconds++;
      const m = String(Math.floor(ventSeconds / 60)).padStart(2, "0");
      const s = String(ventSeconds % 60).padStart(2, "0");
      $("vent-timer").textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    console.error("[Ash] Mic access failed:", err);
    alert("Ash needs microphone access to record your voice memo.");
  }
}

function stopVent() {
  clearInterval(ventTimer);
  if (ventRecorder && ventRecorder.state !== "inactive") {
    ventRecorder.stop();
  }
}

function onVentDone() {
  // Render voice note in context view
  initVoiceNote("ctx");
  showView("vent-context");
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── VOICE NOTE ─────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function initVoiceNote(prefix) {
  const wave = $(`${prefix}-wave`);
  const dur = $(`${prefix}-dur`);
  const playBtn = $(`${prefix}-play`);
  const txtEl = $(`${prefix}-transcript-text`);
  const toggleEl = $(`${prefix}-transcript-toggle`);

  // Draw wave bars
  wave.innerHTML = "";
  for (let i = 0; i < 32; i++) {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = (4 + Math.random() * 20) + "px";
    wave.appendChild(bar);
  }

  // Duration
  const mins = Math.floor(ventSeconds / 60);
  const secs = ventSeconds % 60;
  dur.textContent = `${mins}:${String(secs).padStart(2, "0")}`;

  // Play / pause
  let audio = null;
  let playing = false;

  playBtn.onclick = () => {
    if (!ventUrl) return;
    if (!audio) {
      audio = new Audio(ventUrl);
      audio.addEventListener("ended", () => {
        playing = false;
        playBtn.innerHTML = "&#9654;";
        wave.querySelectorAll(".bar").forEach(b => b.classList.remove("played"));
      });
      audio.addEventListener("timeupdate", () => {
        const pct = audio.currentTime / audio.duration;
        wave.querySelectorAll(".bar").forEach((b, i, all) => {
          b.classList.toggle("played", i / all.length < pct);
        });
      });
    }
    if (playing) {
      audio.pause();
      playing = false;
      playBtn.innerHTML = "&#9654;";
    } else {
      audio.play();
      playing = true;
      playBtn.textContent = "❚❚";
    }
  };

  // Transcript (initially hidden until transcription comes back)
  if (txtEl) {
    if (ventTranscriptText) {
      txtEl.textContent = ventTranscriptText;
      txtEl.parentElement.style.display = "";
    } else {
      txtEl.parentElement.style.display = "none";
    }
  }

  if (toggleEl) {
    toggleEl.onclick = (e) => {
      e.stopPropagation();
      const expanded = txtEl.classList.toggle("expanded");
      toggleEl.textContent = expanded ? "Show less" : "Read more";
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── FILE UPLOAD ────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function addFiles(fileList) {
  const list = $("file-list");
  for (const file of fileList) {
    const idx = uploadedFiles.length;
    uploadedFiles.push(file);

    const pill = document.createElement("div");
    pill.className = "file-pill";

    const icon = file.type.startsWith("image/") ? "&#128444;" :
                 file.type.includes("pdf") ? "&#128196;" : "&#128206;";
    const size = file.size < 1024 ? file.size + " B" :
                 file.size < 1048576 ? (file.size / 1024).toFixed(1) + " KB" :
                 (file.size / 1048576).toFixed(1) + " MB";

    pill.innerHTML = `
      <span>${icon}</span>
      <span class="file-pill-name">${file.name}</span>
      <span class="file-pill-size">${size}</span>
      <button class="file-pill-remove">&times;</button>
    `;

    pill.querySelector(".file-pill-remove").onclick = () => {
      uploadedFiles[idx] = null;
      pill.remove();
    };

    list.appendChild(pill);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── TRANSCRIPTION ──────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

async function transcribeAudio(blob) {
  try {
    const up = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: ASSEMBLYAI_KEY },
      body: blob,
    });
    const { upload_url } = await up.json();

    const req = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { authorization: ASSEMBLYAI_KEY, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    const { id } = await req.json();

    while (true) {
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { authorization: ASSEMBLYAI_KEY },
      });
      const data = await poll.json();
      if (data.status === "completed") return data.text || "";
      if (data.status === "error") throw new Error(data.error);
      await new Promise(r => setTimeout(r, 2500));
    }
  } catch (err) {
    console.error("[Ash] Transcription failed:", err);
    return "";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── BEGIN Q&A ──────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

// Demo mode: set to true for scripted demo flow (no API calls)
const DEMO_MODE = true;

const DEMO_TRANSCRIPT = "I just got out of my session and I'm feeling kind of heavy. My therapist brought up this idea of emotional regulation and how I tend to shut down when things get intense. She pointed out that I've been doing this thing where I catastrophize everything at work and then just go numb. I didn't even realize I was doing it. She also asked about my relationship with my mom and I wasn't ready for that — it caught me off guard. I think there's a pattern there but I don't want to go there yet.";

const DEMO_QUESTIONS = [
  "You mentioned feeling heavy after the session — can you say more about what's weighing on you right now?",
  "Your therapist brought up how you shut down when things get intense. Does that resonate with how you've been feeling this week?",
  "You said you weren't ready to go there with the conversation about your mom. What came up for you in that moment?",
  "You noticed a pattern you hadn't seen before — the catastrophizing at work then going numb. What was it like to hear that reflected back to you?",
];

const DEMO_INSIGHT = {
  summary: "There's a thread running through your session today: you're starting to see how your protective patterns — shutting down, catastrophizing — might be connected to older relational dynamics you haven't fully explored yet. Your therapist gently pointed to something with your mom, and even though you weren't ready, the fact that you noticed your resistance is itself a form of awareness.",
  highlight: "Noticing the pattern is the first step. You don't have to unpack everything at once — but the fact that you're sitting with it instead of pushing it away says a lot about where you are right now.",
};

async function beginQA() {
  showView("processing");

  const bar = $("progress-bar");
  const phrase = $("thinking-phrase");
  bar.style.width = "0%";

  const phrases = [
    "reflecting on what you shared",
    "finding the right questions",
    "connecting the pieces",
    "preparing your debrief",
  ];
  let pi = 0, progress = 0;

  const interval = setInterval(() => {
    pi = (pi + 1) % phrases.length;
    phrase.classList.add("fade-out");
    setTimeout(() => {
      phrase.textContent = phrases[pi];
      phrase.classList.remove("fade-out");
    }, 300);
    progress = Math.min(progress + 18 + Math.random() * 12, 90);
    bar.style.width = progress + "%";
  }, 2000);

  if (DEMO_MODE) {
    // Set fake transcript for voice note display
    ventTranscriptText = DEMO_TRANSCRIPT;
    const ctxTxt = $("ctx-transcript-text");
    if (ctxTxt) {
      ctxTxt.textContent = DEMO_TRANSCRIPT;
      ctxTxt.parentElement.style.display = "";
    }

    // Simulate processing time then go to Q&A
    await delay(3000);
    clearInterval(interval);
    bar.style.width = "100%";

    setTimeout(() => {
      showView("qa");
      startQA(DEMO_QUESTIONS, "demo-debrief-id");
    }, 500);
    return;
  }

  // Transcribe vent in parallel with showing processing
  let transcript = "";
  if (ventBlob) {
    transcript = await transcribeAudio(ventBlob);
    ventTranscriptText = transcript;

    // Update voice note transcript preview
    const ctxTxt = $("ctx-transcript-text");
    if (ctxTxt && transcript) {
      ctxTxt.textContent = transcript;
      ctxTxt.parentElement.style.display = "";
    }
  }

  try {
    const res = await fetch(`${API}/api/debrief/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ventTranscript: transcript, questionnaireAnswers: qAnswers }),
    });
    const data = await res.json();

    clearInterval(interval);
    bar.style.width = "100%";

    setTimeout(() => {
      showView("qa");
      startQA(data.questions || [], data.debriefId);
    }, 500);
  } catch (err) {
    console.error("[Ash] Debrief start failed:", err);
    clearInterval(interval);
    bar.style.width = "100%";

    // Fallback questions
    setTimeout(() => {
      showView("qa");
      startQA([
        "What felt most important about what you just shared?",
        "Was there a moment in the session that surprised you?",
        "How does what came up connect to your day-to-day life?",
      ], null);
    }, 500);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── Q&A CONVERSATION ───────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function startQA(questions, debriefId) {
  qaQuestions = questions;
  qaIndex = 0;
  qaDebriefId = debriefId;
  qaHistory = [];

  $("qa-thread").innerHTML = "";

  if (qaQuestions.length > 0) {
    addBubble("ash", qaQuestions[0]);
    qaHistory.push({ role: "ash", content: qaQuestions[0] });
  }
}

function addBubble(role, text) {
  const thread = $("qa-thread");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  thread.appendChild(bubble);

  // Detect psych terms in Ash messages
  if (role === "ash") {
    const terms = detectTerms(text);
    terms.forEach(t => {
      const tag = document.createElement("span");
      tag.className = "psych-term";
      tag.textContent = t.term;
      tag.title = t.def;
      bubble.appendChild(tag);
    });
  }

  scrollToBottom("qa-scroll");
}

function showTyping() {
  const thread = $("qa-thread");
  const el = document.createElement("div");
  el.className = "typing-dots";
  el.id = "typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  thread.appendChild(el);
  scrollToBottom("qa-scroll");
}

function hideTyping() {
  $("typing")?.remove();
}

function scrollToBottom(id) {
  const el = $(id);
  if (el) el.scrollTop = el.scrollHeight;
}

async function handleQASend() {
  const input = $("qa-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";

  addBubble("user", text);
  qaHistory.push({ role: "user", content: text });
  qaIndex++;

  if (qaIndex < qaQuestions.length) {
    showTyping();
    await delay(700 + Math.random() * 500);
    hideTyping();
    addBubble("ash", qaQuestions[qaIndex]);
    qaHistory.push({ role: "ash", content: qaQuestions[qaIndex] });
  } else {
    // All done — generate insight
    showTyping();
    await generateInsight();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── INSIGHT ────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

async function generateInsight() {
  if (DEMO_MODE) {
    await delay(1500);
    hideTyping();
    currentInsight = DEMO_INSIGHT;
    renderInsight(DEMO_INSIGHT);
    return;
  }

  try {
    const res = await fetch(`${API}/api/debrief/insight`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        debriefId: qaDebriefId,
        qaHistory,
        questionnaireAnswers: qAnswers,
      }),
    });
    const data = await res.json();
    hideTyping();
    currentInsight = data.insight;
    renderInsight(data.insight);
  } catch (err) {
    console.error("[Ash] Insight failed:", err);
    hideTyping();
    currentInsight = {
      summary: "Based on what you shared, it sounds like this session brought up some important threads worth sitting with.",
      highlight: "The way you described your experience suggests you're becoming more aware of your patterns — that's meaningful progress.",
    };
    renderInsight(currentInsight);
  }
}

function renderInsight(insight) {
  const el = $("insight-content");
  const summary = typeof insight === "string" ? insight : insight.summary;
  const highlight = typeof insight === "string" ? null : insight.highlight;

  el.innerHTML = `
    <div class="insight-bubble"><p>${summary}</p></div>
    ${highlight ? `<div class="highlight">${highlight}</div>` : ""}
  `;
  showView("insight");
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── FINISH ─────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

async function finishDebrief() {
  const remDebrief  = $("mem-debrief").checked;
  const remAnswers  = $("mem-answers").checked;
  const remInsight  = $("mem-insight").checked;

  const mins = debriefStart
    ? Math.round((Date.now() - debriefStart) / 60000 * 10) / 10
    : 0;

  // Save to backend (skip in demo mode)
  if (!DEMO_MODE) {
    try {
      await fetch(`${API}/api/debrief/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          debriefId: qaDebriefId,
          remember: { debrief: remDebrief, answers: remAnswers, insight: remInsight },
          qaHistory: remAnswers ? qaHistory : [],
          insight: remInsight ? currentInsight : null,
          questionnaireAnswers: qAnswers,
          durationMinutes: mins,
        }),
      });
    } catch (err) {
      console.error("[Ash] Save failed:", err);
    }
  }

  // Show complete view
  showView("complete");

  // Voice note
  initVoiceNote("done");

  // Update transcript on done voice note
  const doneTxt = $("done-transcript-text");
  if (doneTxt && ventTranscriptText) {
    doneTxt.textContent = ventTranscriptText;
    doneTxt.parentElement.style.display = "";
  }

  // Hairline
  $("hairline").textContent = `you debriefed with Ash for ${mins} mins`;

  // Closing message
  const msg = $("ash-closing-msg");
  if (remDebrief || remAnswers || remInsight) {
    msg.textContent = "I'm gonna remember this for if/when you bring it up in our convo.";
  } else {
    msg.textContent = "No worries — this stays between us for now. I'm here whenever you want to talk.";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── CHAT (complete view) ───────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function handleChatSend() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";

  const scroll = $("chat-scroll");
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble user";
  bubble.textContent = text;
  scroll.appendChild(bubble);
  scroll.scrollTop = scroll.scrollHeight;

  // TODO: hook up to /api/sessions/:id/messages for real AI responses
}

// ─── Auto-resize textareas ──────────────────────────────────────────────────
document.querySelectorAll(".text-input").forEach(el => {
  el.addEventListener("input", () => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  });
});

// ─── Utils ──────────────────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
