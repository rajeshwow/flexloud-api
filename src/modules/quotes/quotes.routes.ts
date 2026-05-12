import { Router } from "express";
import {
  previewQuotePdfHandler,
  sendQuoteEmailHandler,
} from "./quoteEmail.service";
import {
  createQuoteHandler,
  getQuoteByIdHandler,
  getQuotesHandler,
  updateQuoteHandler,
} from "./quotes.service";

const quotesRouter = Router();

quotesRouter.post("/", createQuoteHandler);
quotesRouter.get("/", getQuotesHandler);
// add this before get("/:id")
quotesRouter.get("/:id/pdf", previewQuotePdfHandler);
quotesRouter.get("/:id", getQuoteByIdHandler);
quotesRouter.patch("/:id", updateQuoteHandler);
quotesRouter.post("/:id/email", sendQuoteEmailHandler);

export default quotesRouter;
