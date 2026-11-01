import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names (handles conflicts). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default cn;
