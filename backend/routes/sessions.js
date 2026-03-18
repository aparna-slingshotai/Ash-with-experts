import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { buildContextWindow, streamConversation } from "../lib/claude.js";

export const sessionsRouter = Router();

// ─── POST /api/sessions — Receive transcript, store, async build context ─────

sessionsRouter.post("/", async (req, res) => {
  try {
    const { source, recordedAt, raw, transcript } = req.body;

    if (!transcript || !raw) {
      return res.status(400).json({ error: "transcript and raw are required" });
    }

    const session = await prisma.session.create({
      data: {
        source: source || "ash-extension",
        recordedAt: new Date(recordedAt || Date.now()),
        rawTranscript: raw,
        labeledTranscript: transcript,
      },
    });

    // Respond immediately with sessionId
    res.json({ sessionId: session.id });

    // Async: build context window
    buildContextAsync(session.id, session.userId, transcript);
  } catch (err) {
    console.error("[Ash] POST /api/sessions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function buildContextAsync(sessionId, userId, transcript) {
  try {
    // Fetch previous sessions for longitudinal context
    const previousSessions = await prisma.session.findMany({
      where: {
        userId,
        id: { not: sessionId },
        contextWindow: { not: null },
      },
      orderBy: { recordedAt: "desc" },
      take: 5,
      select: { recordedAt: true, contextWindow: true },
    });

    const contextWindow = await buildContextWindow(transcript, previousSessions);

    // Save context window
    await prisma.session.update({
      where: { id: sessionId },
      data: { contextWindow },
    });

    // Create opening message as first ThreadMessage
    if (contextWindow.openingMessage) {
      await prisma.threadMessage.create({
        data: {
          sessionId,
          role: "assistant",
          content: contextWindow.openingMessage,
        },
      });
    }

    console.log(`[Ash] Context built for session ${sessionId}`);
  } catch (err) {
    console.error(`[Ash] Context build failed for session ${sessionId}:`, err);
  }
}

// ─── GET /api/sessions — List user's sessions ────────────────────────────────

sessionsRouter.get("/", async (_req, res) => {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { recordedAt: "desc" },
      select: {
        id: true,
        recordedAt: true,
        source: true,
        contextWindow: true,
        createdAt: true,
      },
    });

    const result = sessions.map(s => ({
      id: s.id,
      recordedAt: s.recordedAt,
      source: s.source,
      openingMessage: s.contextWindow?.openingMessage || null,
      hasContext: !!s.contextWindow,
      createdAt: s.createdAt,
    }));

    res.json(result);
  } catch (err) {
    console.error("[Ash] GET /api/sessions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/sessions/:id — Full session + context + messages ───────────────

sessionsRouter.get("/:id", async (req, res) => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({
      id: session.id,
      recordedAt: session.recordedAt,
      source: session.source,
      rawTranscript: session.rawTranscript,
      labeledTranscript: session.labeledTranscript,
      contextWindow: session.contextWindow,
      messages: session.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error("[Ash] GET /api/sessions/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/sessions/:id/messages — User message → Claude streaming ───────

sessionsRouter.post("/:id/messages", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }

    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (!session.contextWindow) {
      return res.status(425).json({ error: "Context window still building" });
    }

    // Save user message
    await prisma.threadMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content,
      },
    });

    // Build message history for Claude
    const messages = [
      ...session.messages.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content },
    ];

    // Stream response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = streamConversation(session.contextWindow, messages);
    let fullResponse = "";

    stream.on("text", (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
    });

    stream.on("end", async () => {
      // Save assistant message
      const saved = await prisma.threadMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content: fullResponse,
        },
      });

      res.write(`data: ${JSON.stringify({ type: "done", messageId: saved.id })}\n\n`);
      res.end();
    });

    stream.on("error", (err) => {
      console.error("[Ash] Stream error:", err);
      res.write(`data: ${JSON.stringify({ type: "error", error: "Stream failed" })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error("[Ash] POST /api/sessions/:id/messages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
