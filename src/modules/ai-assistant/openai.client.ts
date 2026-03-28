import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  // fail fast in prod/deploy
  console.warn("OPENAI_API_KEY is missing. AI assistant endpoints will fail.");
}

export const openaiClient = new OpenAI({
  apiKey,
});

export const AI_MODEL =
  process.env.OPENAI_MODEL_AI_ASSISTANT?.trim() || "gpt-5.4-mini";
