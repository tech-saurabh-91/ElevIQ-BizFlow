import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import env from '../config/env.js';
import { APP_NAME } from '../config/constants.js';

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: `${APP_NAME} API`,
      version: '1.0.0',
      description: `
Multi-tenant Sales Force Automation + Order & Invoice SaaS.

**Two layers:**
- \`/api/platform/*\` — Service Provider (SaaS owner) admin panel.
- \`/api/v1/*\` — Company workspace (per-tenant).
- \`/api/auth/*\` — shared auth entrypoints.

**Auth:** Bearer access token (15 min) + httpOnly refresh cookie (7 days, rotated).

**Tenancy:** every tenant document carries an indexed \`companyId\`, injected
automatically from the verified JWT. Requests may never choose their own tenant.
      `,
      contact: { name: 'ElevIQ SFA', email: 'support@eleviqsfa.com' },
    },
    servers: [
      { url: `http://localhost:${env.port}`, description: 'Local' },
      { url: 'https://api.eleviqsfa.com', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'eleviq_rt' },
      },
      schemas: {
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {},
            meta: { type: 'object' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            code: { type: 'string', example: 'VALIDATION_ERROR' },
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
            requestId: { type: 'string' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            pages: { type: 'integer' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Invalid, missing or expired credentials',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { success: false, code: 'TOKEN_INVALID', message: 'Invalid access token' },
            },
          },
        },
        Forbidden: {
          description: 'Insufficient permissions or company suspended/expired',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { success: false, code: 'FORBIDDEN', message: 'You do not have permission' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        ValidationError: {
          description: 'Validation failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                errors: [{ field: 'email', message: 'Valid email is required', location: 'body' }],
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Health' },
      { name: 'Platform Auth' },
      { name: 'Platform Companies' },
      { name: 'Platform Plans' },
      { name: 'Auth' },
      { name: 'Users' },
      { name: 'Customers' },
      { name: 'Products' },
      { name: 'Orders' },
      { name: 'Invoices' },
      { name: 'Payments' },
      { name: 'Reports' },
    ],
  },
  apis: ['./src/routes/**/*.js', './src/docs/paths/**/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
export { swaggerUi };
export default swaggerSpec;
