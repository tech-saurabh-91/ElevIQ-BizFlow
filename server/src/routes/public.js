import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import env from '../config/env.js';
import { validate } from '../middlewares/validate.js';
import { createDemoRequest } from '../controllers/publicController.js';

/**
 * /api/public/* - endpoints for the public home page. No login.
 */
const router = Router();

/** At most 5 demo requests per IP per hour (stops form spam). */
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please call or WhatsApp us instead.' },
});

const text = (max) => z.string().trim().max(max);

export const demoRequestSchema = z.object({
  name: text(120).min(2, 'Please enter your name'),
  business: text(160).min(2, 'Please enter your business name'),
  mobile: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
  city: text(80).min(2, 'Please enter your city'),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160).optional().or(z.literal('')),
  businessType: text(60).optional().default(''),
  teamSize: text(60).optional().default(''),
  message: text(1000).optional().default(''),
  /** Honeypot - hidden from people, filled by bots. */
  website: z.string().max(200).optional(),
});

router.post('/demo-requests', demoLimiter, validate({ body: demoRequestSchema }), createDemoRequest);

export default router;
