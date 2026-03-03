// ===========================================
// API Documentation Routes
// ===========================================
// Serves Swagger UI and the OpenAPI spec JSON.

import { Router, type IRouter } from 'express';
import { createRequire } from 'module';
import { generateOpenAPISpec } from '../lib/openapi.js';

const require = createRequire(import.meta.url);
const swaggerUi = require('swagger-ui-express') as typeof import('swagger-ui-express');

const router: IRouter = Router();
const spec = generateOpenAPISpec();

router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(spec));
router.get('/spec.json', (_req, res) => {
  res.json(spec);
});

export default router;
