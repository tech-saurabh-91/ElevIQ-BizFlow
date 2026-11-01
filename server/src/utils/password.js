import { BadRequestError } from './errors.js';

/**
 * Password policy shared by seeding, admin reset, and self-service change.
 * Policy: >= 8 chars, at least one upper, one lower, one digit, one symbol.
 * Not a common weak password.
 */
const WEAK = [
  'password', '12345678', 'qwerty123', 'letmein', 'welcome1', 'admin123',
  'password1', 'iloveyou', 'sunshine', 'princess', 'football', 'eleviq123',
];

export const validatePasswordPolicy = (password) => {
  const value = String(password || '');
  const errors = [];

  if (value.length < 8) errors.push({ field: 'password', message: 'Password must be at least 8 characters' });
  if (!/[a-z]/.test(value)) errors.push({ field: 'password', message: 'Password must contain a lowercase letter' });
  if (!/[A-Z]/.test(value)) errors.push({ field: 'password', message: 'Password must contain an uppercase letter' });
  if (!/[0-9]/.test(value)) errors.push({ field: 'password', message: 'Password must contain a number' });
  if (!/[^A-Za-z0-9]/.test(value)) errors.push({ field: 'password', message: 'Password must contain a symbol' });
  if (WEAK.includes(value.toLowerCase())) errors.push({ field: 'password', message: 'Password is too common' });

  if (errors.length) {
    throw new BadRequestError('Password does not meet the security policy', 'WEAK_PASSWORD', errors);
  }
  return true;
};

export default validatePasswordPolicy;
