import { Router } from "express";
import {
  generateFollowupHandler,
  getAIInsightsHandler,
  summarizeActivitiesHandler,
} from "./ai-assistant.service";

const aiAssistantRouter = Router();

aiAssistantRouter.get("/insights", getAIInsightsHandler);
aiAssistantRouter.post("/generate-followup", generateFollowupHandler);
aiAssistantRouter.post("/summarize-activities", summarizeActivitiesHandler);

export default aiAssistantRouter;
