import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { anthropic } from "../lib/claude.js";

export const debriefRouter = Router();

const DEBRIEF_SYSTEM = `You are Ash, a compassionate AI companion that works alongside therapy — never instead of it.

A user has just finished a therapy session and wants to debrief. They may have vented (voice memo transcript) and optionally answered a quick check-in questionnaire.

Your job is to generate 3-5 thoughtful, open-ended questions that help the user process what came up. Guidelines:
- Use the user's own language and phrasing from their vent
- Be curious, not prescriptive
- If the vent mentions psychology concepts, note them so they can be explained
- Questions should go deeper, not repeat what the user already said
- Keep questions warm and conversational — not clinical

Output valid JSON:
{
  "questions": ["string"],
  "detectedTerms": [{ "term": "string", "definition": "string" }]
}`;

const INSIGHT_SYSTEM = `You are Ash, a compassionate AI companion that works alongside therapy — never instead of it.

You have the full context of a debrief conversation: the user's vent, their questionnaire answers, and their responses to your follow-up questions.

Generate a single, meaningful insight from this debrief. Guidelines:
- Mirror the user's own words and language
- Connect dots they might not have seen
- Never diagnose or use clinical language the therapist didn't introduce
- Be warm and grounded, not generic
- If psychology terms came up, briefly explain them in accessible language

Output valid JSON:
{
  "summary": "string (2-3 sentences capturing the core insight)",
  "highlight": "string (one key takeaway, written warmly)"
}`;

// ─── POST /api/debrief/start — Generate Q&A questions from vent ─────────────

const FALLBACK_QUESTIONS = [
  "What felt most important about what you just shared?",
  "Was there a moment in the session that surprised you?",
  "How does what came up connect to your day-to-day life?",
  "What would you want to explore more next time?",
];

debriefRouter.post("/start", async (req, res) => {
  try {
    const { ventTranscript, questionnaireAnswers } = req.body;

    // Create debrief record
    const debrief = await prisma.debrief.create({
      data: {
        ventTranscript: ventTranscript || "",
        questionnaireAnswers: questionnaireAnswers || {},
      },
    });

    // If no API key, return fallback questions
    if (!anthropic) {
      return res.json({
        debriefId: debrief.id,
        questions: FALLBACK_QUESTIONS,
        detectedTerms: [],
      });
    }

    let userContent = "";
    if (ventTranscript) {
      userContent += `The user vented the following:\n\n"${ventTranscript}"\n\n`;
    }
    if (questionnaireAnswers && Object.keys(questionnaireAnswers).length > 0) {
      userContent += `Quick check-in responses:\n`;
      for (const [key, val] of Object.entries(questionnaireAnswers)) {
        userContent += `- ${key}: ${val}\n`;
      }
    }

    if (!userContent) {
      userContent = "The user wants to debrief but didn't share specifics yet. Ask gentle, open-ended questions about how their session went.";
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: DEBRIEF_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    const parsed = JSON.parse(jsonStr);

    res.json({
      debriefId: debrief.id,
      questions: parsed.questions || [],
      detectedTerms: parsed.detectedTerms || [],
    });
  } catch (err) {
    console.error("[Ash] POST /api/debrief/start error:", err);
    res.status(500).json({ error: "Failed to generate debrief questions" });
  }
});

// ─── POST /api/debrief/insight — Generate insight from Q&A ──────────────────

debriefRouter.post("/insight", async (req, res) => {
  try {
    const { debriefId, qaHistory, questionnaireAnswers } = req.body;

    // If no API key, return fallback insight based on what we have
    if (!anthropic) {
      const userMessages = (qaHistory || []).filter(m => m.role === "user").map(m => m.content);
      const lastAnswer = userMessages[userMessages.length - 1] || "what you shared";
      const mood = questionnaireAnswers?.mood || "";

      const insight = {
        summary: `Based on what you shared, it sounds like this session brought up some important threads worth sitting with. ${mood ? `You mentioned feeling "${mood.toLowerCase()}" — that's worth paying attention to.` : ""}`,
        highlight: "The fact that you're taking the time to debrief shows real self-awareness. That's meaningful progress in itself.",
      };

      if (debriefId) {
        await prisma.debrief.update({
          where: { id: debriefId },
          data: { insight, qaHistory },
        });
      }

      return res.json({ insight });
    }

    let userContent = "";
    if (questionnaireAnswers && Object.keys(questionnaireAnswers).length > 0) {
      userContent += `Check-in responses:\n`;
      for (const [key, val] of Object.entries(questionnaireAnswers)) {
        userContent += `- ${key}: ${val}\n`;
      }
      userContent += "\n";
    }

    // Fetch vent transcript if we have a debriefId
    if (debriefId) {
      const debrief = await prisma.debrief.findUnique({ where: { id: debriefId } });
      if (debrief?.ventTranscript) {
        userContent += `User's vent:\n"${debrief.ventTranscript}"\n\n`;
      }
    }

    userContent += `Debrief conversation:\n`;
    qaHistory.forEach(msg => {
      userContent += `${msg.role === "ash" ? "Ash" : "User"}: ${msg.content}\n`;
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: INSIGHT_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    const insight = JSON.parse(jsonStr);

    // Update debrief record with insight
    if (debriefId) {
      await prisma.debrief.update({
        where: { id: debriefId },
        data: { insight, qaHistory },
      });
    }

    res.json({ insight });
  } catch (err) {
    console.error("[Ash] POST /api/debrief/insight error:", err);
    res.status(500).json({ error: "Failed to generate insight" });
  }
});

// ─── POST /api/debrief/complete — Save memory consent + finalize ────────────

debriefRouter.post("/complete", async (req, res) => {
  try {
    const { debriefId, remember, qaHistory, insight, questionnaireAnswers, durationMinutes } = req.body;

    if (debriefId) {
      await prisma.debrief.update({
        where: { id: debriefId },
        data: {
          rememberDebrief: remember?.debrief ?? false,
          rememberAnswers: remember?.answers ?? false,
          rememberInsight: remember?.insight ?? false,
          qaHistory: remember?.answers ? qaHistory : [],
          insight: remember?.insight ? insight : null,
          durationMinutes: durationMinutes || 0,
          completedAt: new Date(),
        },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Ash] POST /api/debrief/complete error:", err);
    res.status(500).json({ error: "Failed to save debrief" });
  }
});

// ─── GET /api/debrief — List debrief history ────────────────────────────────

debriefRouter.get("/", async (_req, res) => {
  try {
    const debriefs = await prisma.debrief.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        durationMinutes: true,
        rememberDebrief: true,
        rememberInsight: true,
        insight: true,
      },
    });
    res.json(debriefs);
  } catch (err) {
    console.error("[Ash] GET /api/debrief error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
