import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import { exportContactsTable } from "../table-export/table-export.service";
import {
  createContactHandler,
  getContactByIdHandler,
  getContactsHandler,
  updateContactHandler,
} from "./contacts.service";

const contactsRouter = Router();

contactsRouter.get(
  "/export",
  requirePermissions(["contacts.export"]),
  exportContactsTable,
);

contactsRouter.post("/", createContactHandler);
contactsRouter.get("/", getContactsHandler);
contactsRouter.get("/:id", getContactByIdHandler);
contactsRouter.patch("/:id", updateContactHandler);

export default contactsRouter;
