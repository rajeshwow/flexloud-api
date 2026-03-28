import { Router } from "express";
import { getLeadInsightsHandler } from "./ai-insights.service";

const aiInsightsRouter = Router();

/**
 * GET /:slug/ai-insights/leads/:id
 * Get AI insights for a lead
 */
aiInsightsRouter.get("/leads/:id", getLeadInsightsHandler);

export default aiInsightsRouter;
