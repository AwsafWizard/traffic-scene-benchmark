import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ModelRow, ProviderResult, Question } from "./types";

const SYSTEM = `You are answering a question about a traffic or road scene shown in an image.
Answer only from what is visible in the image plus standard road rules.
Respond with a single JSON object and nothing else:
{"answer": "<your answer>", "reasoning": "<brief justification, max 3 sentences>"}
For multiple-choice questions, "answer" must be exactly one of the given options, copied verbatim.`;

/**
 * Follow-up turns are a conversation, not a scored answer, so they drop the JSON
 * contract and reply in prose.
 */
const FOLLOWUP_SYSTEM = `You are discussing a traffic or road scene shown in an image.
Your first reply was formatted as JSON; from now on answer in plain prose, briefly.
Ground every claim in what is actually visible in the image, and say so plainly when
the image does not settle the question.`;

/** One prior exchange in a follow-up thread. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function buildUserPrompt(q: Question): string {
  const options = q.options ? (JSON.parse(q.options) as string[]) : null;
  if (q.answer_type === "mcq" && options?.length) {
    return `${q.prompt}\n\nOptions:\n${options.map((o) => `- ${o}`).join("\n")}`;
  }
  return q.prompt;
}

function parseAnswer(text: string): ProviderResult {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
        answer?: unknown;
        reasoning?: unknown;
      };
      if (typeof obj.answer === "string") {
        return {
          answer: obj.answer,
          reasoning: typeof obj.reasoning === "string" ? obj.reasoning : null,
          raw: text,
        };
      }
    } catch {
      // fall through to raw text
    }
  }
  return { answer: cleaned || null, reasoning: null, raw: text };
}

function extraOf(model: ModelRow): Record<string, unknown> {
  if (!model.extra) return {};
  try {
    return JSON.parse(model.extra) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function callAnthropic(
  model: ModelRow,
  prompt: string,
  imageB64: string,
  mediaType: string,
  turns: Turn[],
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: model.model_id,
    max_tokens: 2000,
    system: turns.length ? FOLLOWUP_SYSTEM : SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: imageB64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
      ...turns.map((t) => ({ role: t.role, content: t.content })),
    ],
    ...extraOf(model),
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");
}

async function callOpenAI(
  model: ModelRow,
  prompt: string,
  imageB64: string,
  mediaType: string,
  turns: Turn[],
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model: model.model_id,
    messages: [
      { role: "system", content: turns.length ? FOLLOWUP_SYSTEM : SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageB64}` } },
        ],
      },
      ...turns.map((t) => ({ role: t.role, content: t.content })),
    ],
    ...extraOf(model),
  });
  return response.choices[0]?.message?.content ?? "";
}

async function callGoogle(
  model: ModelRow,
  prompt: string,
  imageB64: string,
  mediaType: string,
  turns: Turn[],
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model.model_id,
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType: mediaType, data: imageB64 } }, { text: prompt }],
      },
      // Gemini calls the assistant role "model".
      ...turns.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
    ],
    config: {
      systemInstruction: turns.length ? FOLLOWUP_SYSTEM : SYSTEM,
      ...extraOf(model),
    },
  });
  return response.text ?? "";
}

async function call(
  model: ModelRow,
  prompt: string,
  imageB64: string,
  mediaType: string,
  turns: Turn[],
): Promise<string> {
  switch (model.provider) {
    case "anthropic":
      return callAnthropic(model, prompt, imageB64, mediaType, turns);
    case "openai":
      return callOpenAI(model, prompt, imageB64, mediaType, turns);
    case "google":
      return callGoogle(model, prompt, imageB64, mediaType, turns);
    default:
      throw new Error(`${model.provider} models can't be called — paste the answer instead.`);
  }
}

/** The scored first answer. Expects the JSON contract. */
export async function askModel(
  model: ModelRow,
  question: Question,
  imageB64: string,
  mediaType: string,
): Promise<ProviderResult> {
  const text = await call(model, buildUserPrompt(question), imageB64, mediaType, []);
  return parseAnswer(text);
}

/**
 * A follow-up turn. `turns` is the thread so far, starting with the model's
 * first answer, and ending with the new question being asked.
 */
export async function askFollowUp(
  model: ModelRow,
  question: Question,
  imageB64: string,
  mediaType: string,
  turns: Turn[],
): Promise<string> {
  return call(model, buildUserPrompt(question), imageB64, mediaType, turns);
}
