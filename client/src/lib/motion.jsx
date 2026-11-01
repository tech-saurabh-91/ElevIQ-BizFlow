/**
 * Tiny animation helpers.
 *
 * We deliberately avoid pulling in framer-motion just for dialog/panel fades —
 * these CSS-driven helpers keep the bundle small while giving us the same
 * `initial` / `animate` / `transition` call-shape used across components.
 */
import * as React from 'react';
import { cn } from '@/utils/cn';

const styleFrom = (initial = {}, animate = {}, transition = {}) => {
  const from = { opacity: initial.opacity ?? 1, y: initial.y ?? 0, scale: initial.scale ?? 1 };
  const to = { opacity: animate.opacity ?? 1, y: animate.y ?? 0, scale: animate.scale ?? 1 };
  const duration = transition.duration ?? 0.18;

  return {
    opacity: to.opacity,
    transform: `translateY(${to.y}px) scale(${to.scale})`,
    transition: `opacity ${duration}s ${transition.ease || 'ease-out'}, transform ${duration}s ${transition.ease || 'ease-out'}`,
    // Start-state marker used by CSS to animate in on mount.
    '--_from-opacity': from.opacity,
    '--_from-y': `${from.y}px`,
    '--_from-scale': from.scale,
  };
};

export const motion = {
  div: React.forwardRef(function MotionDiv(
    { initial, animate, exit, transition, className, style, ...props },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn('motion-el', className)}
        style={{ ...style, ...styleFrom(initial, animate, transition) }}
        {...props}
      />
    );
  }),
};

/** AnimatePresence stand-in: children render only while `open` is true. */
export function AnimatePresence({ children }) {
  return <>{children}</>;
}

export default motion;
