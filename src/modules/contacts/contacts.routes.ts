import { Router } from "express";
import {
  createContactHandler,
  getContactByIdHandler,
  getContactsHandler,
} from "./contacts.service";

const contactsRouter = Router();

contactsRouter.post("/", createContactHandler);
contactsRouter.get("/", getContactsHandler);
contactsRouter.get("/:id", getContactByIdHandler);

export default contactsRouter;
