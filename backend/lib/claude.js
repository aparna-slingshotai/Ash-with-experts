import Anthropic from "@anthropic-ai/sdk";

const hasKey = !!process.env.ANTHROPIC_API_KEY;

export const anthropic = hasKey
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const SYSTEM_PROMPT = `You are Ash, a compassionate AI that works alongside therapy — never instead of it.

You are given a labeled transcript of a therapy session. Utterances labeled "You" are the patient's voice. Utterances labeled "Therapist" are the therapist's clinical voice.

Your job is to build a structured context window from this session. Follow these rules carefully:

1. Do NOT summarize or compress — preserve the texture, specific language, and phrasing used by both speakers.
2. Never diagnose or introduce clinical language the therapist didn't use.
3. Mirror the patient's own words and phrases back to them.
4. Extract the following:
   - themes[]: Key themes discussed (use the patient's language)
   - therapistInsights[]: Specific observations, reframes, or guidance the therapist offered
   - patientPatterns[]: Recurring patterns, behaviors, or emotional states the patient described
   - unresolvedThreads[]: Topics that were raised but not fully explored, or that ended with open questions
5. Write an openingMessage that seeds a follow-up conversation. It should reference 2-3 specific observations using the patient's own language. Example tone: "I've listened to your session. A few things stood out — [observations]. What's on your mind?"

Output valid JSON with this exact structure:
{
  "themes": ["string"],
  "therapistInsights": ["string"],
  "patientPatterns": ["string"],
  "unresolvedThreads": ["string"],
  "openingMessage": "string"
}`;

const LONGITUDINAL_ADDENDUM = `

You also have access to context windows from the patient's previous sessions. Use them to:
- Connect themes across sessions
- Notice patterns that recur or evolve over time
- Reference previous sessions naturally (e.g., "Last time you mentioned...")
- Track whether unresolved threads from earlier sessions were addressed`;

export async function buildContextWindow(labeledTranscript, previousSessions = []) {
  const transcriptText = labeledTranscript
    .map(u => `${u.speaker}: ${u.text}`)
    .join("\n");

  let systemPrompt = SYSTEM_PROMPT;

  let userContent = `Here is the therapy session transcript:\n\n${transcriptText}`;

  if (previousSessions.length > 0) {
    systemPrompt += LONGITUDINAL_ADDENDUM;
    const prevContext = previousSessions.map((s, i) => {
      const ctx = s.contextWindow;
      return `--- Session ${i + 1} (${s.recordedAt.toISOString().split("T")[0]}) ---
Themes: ${ctx.themes?.join(", ") || "none"}
Therapist Insights: ${ctx.therapistInsights?.join("; ") || "none"}
Patient Patterns: ${ctx.patientPatterns?.join("; ") || "none"}
Unresolved Threads: ${ctx.unresolvedThreads?.join("; ") || "none"}`;
    }).join("\n\n");

    userContent += `\n\n--- Previous Session Context ---\n${prevContext}`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content[0].text;

  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
  return JSON.parse(jsonStr);
}

const CONVERSATION_SYSTEM = `You are Ash, a compassionate AI companion that works alongside therapy — never instead of it.

You have access to the patient's therapy session context. Use it to have a warm, grounded conversation. Key principles:
- Mirror the patient's own words and language
- Never diagnose or use clinical language the therapist didn't introduce
- Be curious, not prescriptive
- If the patient asks about something from the session, reference the specifics
- Keep responses concise and warm — 2-4 sentences unless more detail is needed
- You are not a therapist. You are a thoughtful companion helping the patient reflect between sessions.`;

export function streamConversation(contextWindow, messages) {
  const contextPreamble = `Session context:
Themes: ${contextWindow.themes?.join(", ")}
Therapist Insights: ${contextWindow.therapistInsights?.join("; ")}
Patient Patterns: ${contextWindow.patientPatterns?.join("; ")}
Unresolved Threads: ${contextWindow.unresolvedThreads?.join("; ")}`;

  return anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `${CONVERSATION_SYSTEM}\n\n${contextPreamble}`,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });
}
