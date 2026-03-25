import { Router } from "express";
import {
  createContactHandler,
  getContactByIdHandler,
  getContactsHandler,
  updateContactHandler,
} from "./contacts.service";

const contactsRouter = Router();

contactsRouter.post("/", createContactHandler);
contactsRouter.get("/", getContactsHandler);
contactsRouter.get("/:id", getContactByIdHandler);
contactsRouter.patch("/:id", updateContactHandler);

export default contactsRouter;
