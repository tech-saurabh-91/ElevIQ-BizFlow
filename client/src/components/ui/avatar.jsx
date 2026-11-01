import { cn } from '@/utils/cn';
import { initials as toInitials } from '@/utils/format';

const sizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

const hues = [
  'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  'bg-orange-500/15 text-orange-600 dark:text-orange-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'bg-teal-500/15 text-teal-600 dark:text-teal-300',
  'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
  'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300',
];

const hueFor = (seed = '') => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 1000;
  return hues[h % hues.length];
};

export function Avatar({ name = '', src, size = 'md', className, ...props }) {
  const initials = toInitials(name);
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        sizes[size],
        hueFor(name || src || 'x'),
        !src && 'uppercase',
        className
      )}
      title={name}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        initials || '?'
      )}
    </span>
  );
}

export const AvatarGroup = ({ users = [], max = 4, size = 'sm', className }) => {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className={cn('flex -space-x-2 items-center', className)}>
      {shown.map((u, i) => (
        <Avatar key={u.id || i} name={u.name} src={u.avatar} size={size} className="ring-2 ring-background" />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-muted font-medium ring-2 ring-background',
            sizes[size]
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
};

export default Avatar;
