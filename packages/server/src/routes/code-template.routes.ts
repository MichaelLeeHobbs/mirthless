import { Router, type IRouter } from 'express';
import {
  createCodeTemplateLibrarySchema,
  updateCodeTemplateLibrarySchema,
  createCodeTemplateSchema,
  updateCodeTemplateSchema,
  codeTemplateListQuerySchema,
  codeTemplateUuidParamSchema,
} from '@galvanigraph/core-models';
import { CodeTemplateController } from '../controllers/code-template.controller.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

router.get(
  '/libraries',
  requirePermission('code_templates:read'),
  CodeTemplateController.listLibraries,
);

router.post(
  '/libraries',
  requirePermission('code_templates:write'),
  validate({ body: createCodeTemplateLibrarySchema }),
  CodeTemplateController.createLibrary,
);

router.put(
  '/libraries/:id',
  requirePermission('code_templates:write'),
  validate({ params: codeTemplateUuidParamSchema, body: updateCodeTemplateLibrarySchema }),
  CodeTemplateController.updateLibrary,
);

router.delete(
  '/libraries/:id',
  requirePermission('code_templates:delete'),
  validate({ params: codeTemplateUuidParamSchema }),
  CodeTemplateController.deleteLibrary,
);

router.get(
  '/',
  requirePermission('code_templates:read'),
  validate({ query: codeTemplateListQuerySchema }),
  CodeTemplateController.listTemplates,
);

router.post(
  '/',
  requirePermission('code_templates:write'),
  validate({ body: createCodeTemplateSchema }),
  CodeTemplateController.createTemplate,
);

router.put(
  '/:id',
  requirePermission('code_templates:write'),
  validate({ params: codeTemplateUuidParamSchema, body: updateCodeTemplateSchema }),
  CodeTemplateController.updateTemplate,
);

router.delete(
  '/:id',
  requirePermission('code_templates:delete'),
  validate({ params: codeTemplateUuidParamSchema }),
  CodeTemplateController.deleteTemplate,
);

export default router;
