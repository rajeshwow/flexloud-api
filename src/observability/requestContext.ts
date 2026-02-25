import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  userId?: string;
  tenantId?: string;
  roles?: string[];
};

export const requestContext = new AsyncLocalStorage<RequestContext>();
