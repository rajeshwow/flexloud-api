import { Router } from "express";
import { sendQuoteEmailHandler } from "./quoteEmail.service";
import {
  createQuoteHandler,
  getQuoteByIdHandler,
  getQuotesHandler,
  updateQuoteHandler,
} from "./quotes.service";

const quotesRouter = Router();

quotesRouter.post("/", createQuoteHandler);
quotesRouter.get("/", getQuotesHandler);
quotesRouter.get("/:id", getQuoteByIdHandler);
quotesRouter.patch("/:id", updateQuoteHandler);
quotesRouter.post("/:id/email", sendQuoteEmailHandler);

export default quotesRouter;
