// ===========================================
// Code Template Routes
// ===========================================

import { Router, type IRouter } from 'express';
import {
  createCodeTemplateLibrarySchema,
  updateCodeTemplateLibrarySchema,
  createCodeTemplateSchema,
  updateCodeTemplateSchema,
  codeTemplateListQuerySchema,
  codeTemplateUuidParamSchema,
} from '@mirthless/core-models';
import { CodeTemplateController } from '../controllers/code-template.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router: IRouter = Router();

// All code template routes require authentication
router.use(authenticate);

// ----- Libraries -----

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
  requirePermission('code_templates:write'),
  validate({ params: codeTemplateUuidParamSchema }),
  CodeTemplateController.deleteLibrary,
);

// ----- Templates -----

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
  requirePermission('code_templates:write'),
  validate({ params: codeTemplateUuidParamSchema }),
  CodeTemplateController.deleteTemplate,
);

export default router;
