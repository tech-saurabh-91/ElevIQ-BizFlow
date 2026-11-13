import { z } from 'zod';

export const platformLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const companyLoginSchema = z.object({
  identifier: z.string().trim().min(3, 'Email or phone is required'),
  password: z.string().min(1, 'Password is required'),
  companyCode: z.string().trim().toUpperCase().optional().or(z.literal('')),
  remember: z.boolean().optional().default(false),
});

export const refreshSchema = z.object({
  // body is usually empty; cookie carries the token
  token: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
}).refine((v) => v.newPassword !== v.currentPassword, {
  path: ['newPassword'],
  message: 'Choose a password different from the current one',
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Valid email is required'),
  scope: z.enum(['company', 'platform']).default('company'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
  scope: z.enum(['company', 'platform']).default('company'),
});

export const logoutSchema = z.object({
  all: z.boolean().optional().default(false),
});

export default { platformLoginSchema, companyLoginSchema, changePasswordSchema };
