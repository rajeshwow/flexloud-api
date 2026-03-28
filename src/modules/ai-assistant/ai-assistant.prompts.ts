import type { AIEntityType } from "./ai-assistant.types";

export function buildInsightInstructions(entityType: AIEntityType) {
  return [
    "You are a CRM sales assistant.",
    `Analyze the provided ${entityType} data.`,
    "Return concise, actionable business output.",
    "Do not mention missing IDs or internal system fields.",
    "Do not fabricate facts.",
    "Prefer practical next actions.",
    "Priority must be exactly one of: hot, warm, cold.",
    "Sentiment must be exactly one of: positive, neutral, negative.",
    "Confidence must be between 0 and 100.",
    "Risk flags must be short and business-friendly.",
    "Next best actions must be concrete and executable.",
  ].join(" ");
}

export function buildFollowupInstructions(channel: "email" | "whatsapp") {
  return [
    "You are a CRM sales assistant generating a follow-up draft.",
    `Generate a ${channel} follow-up draft.`,
    "Keep it professional, concise, and natural.",
    "Do not overpromise.",
    "Use business-friendly language.",
    "If there is not enough context, keep it neutral and safe.",
  ].join(" ");
}

export function buildActivitySummaryInstructions() {
  return [
    "You are a CRM assistant summarizing business activities.",
    "Create a crisp summary from timeline/activity data.",
    "Focus on decisions, customer intent, blockers, and next step.",
    "Avoid internal jargon unless clearly present in the data.",
  ].join(" ");
}
