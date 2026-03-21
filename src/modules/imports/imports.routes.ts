import { Router } from "express";
import {
  downloadImportSampleHandler,
  executeImportHandler,
  getImportTemplateMetaHandler,
  importUpload,
  validateImportHandler,
} from "./imports.service";

const importsRouter = Router({ mergeParams: true });

importsRouter.get("/:module/template", getImportTemplateMetaHandler);
importsRouter.get("/:module/sample-file", downloadImportSampleHandler);
importsRouter.post(
  "/:module/validate",
  importUpload.single("file"),
  validateImportHandler,
);
importsRouter.post(
  "/:module/execute",
  importUpload.single("file"),
  executeImportHandler,
);

export default importsRouter;
