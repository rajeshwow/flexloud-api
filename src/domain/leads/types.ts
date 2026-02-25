export type LeadStatus = "OPEN" | "WON" | "LOST" | "ARCHIVED";

export type Lead = {
  id: string;
  tenantId: string;
  title: string;
  source?: string;
  status: LeadStatus;
  ownerUserId: string | null;
  currentStageId: string | null;
  createdAt: string;
  updatedAt: string;
};
