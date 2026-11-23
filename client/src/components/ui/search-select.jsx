import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * A dropdown you can type into: for long lists (products, hundreds of them)
 * where scrolling a native <select> is not workable. Every word typed must
 * match the label or the hint (code, SKU, barcode), in any order.
 *
 * @param {object}   props
 * @param {string}   props.value     - the chosen option's value ('' for none)
 * @param {Function} props.onChange  - called with the new value
 * @param {Array}    props.options   - `{ value, label, hint?, keywords? }`
 */
const MAX_SHOWN = 60;
const norm = (s) => String(s || '').toLowerCase();

export function SearchSelect({
  value = '',
  onChange,
  onBlur,
  options = [],
  placeholder = 'Type to search…',
  emptyText = 'Nothing matches',
  error,
  disabled,
  className,
  id,
  name,
  'aria-label': ariaLabel,
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);

  const selected = useMemo(() => options.find((o) => String(o.value) === String(value)), [options, value]);
  const display = selected ? `${selected.label}${selected.hint ? ` (${selected.hint})` : ''}` : '';

  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const text = `${norm(o.label)} ${norm(o.hint)} ${norm(o.keywords)}`;
      return words.every((w) => text.includes(w));
    });
  }, [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);

  // The list floats over everything (dialogs and scrolling tables clip a normal one).
  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    setRect({ left: r.left, width: r.width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, max: Math.min(320, (up ? r.top : below) - 12) });
  };
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onMove = (e) => {
      if (listRef.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    const at = shown.findIndex((o) => String(o.value) === String(value));
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (option) => {
    if (!option) return;
    if (String(option.value) !== String(value)) onChange?.(option.value);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (shown.length ? (a + step + shown.length) % shown.length : 0));
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        choose(shown[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        close();
      }
    } else if (e.key === 'Tab') {
      // Typing a code and tabbing away picks the only (or first) match.
      if (open && query && shown.length) choose(shown[active]);
      else close();
    }
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={open && display ? display : placeholder}
        value={open ? query : display}
        onFocus={openList}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          onBlur?.();
        }}
        title={display || undefined}
        className={cn(
          'flex h-10 w-full truncate rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm shadow-sm placeholder:text-muted-foreground',
          'focus-ring disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive'
        )}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {open &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            style={{ left: rect.left, width: Math.max(rect.width, 240), top: rect.top, bottom: rect.bottom, maxHeight: rect.max }}
            className="fixed z-[70] overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
            // Keep the focus in the input so typing goes on working.
            onMouseDown={(e) => e.preventDefault()}
          >
            {shown.length === 0 && <li className="px-2 py-2 text-muted-foreground">{emptyText}</li>}
            {shown.map((o, i) => {
              const isSel = String(o.value) === String(value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSel}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5', i === active && 'bg-accent text-accent-foreground')}
                >
                  <Check className={cn('mt-0.5 h-4 w-4 shrink-0', isSel ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                  </span>
                </li>
              );
            })}
            {matches.length > shown.length && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                {matches.length - shown.length} more - keep typing to narrow down
              </li>
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}

/** Product options for SearchSelect: name, with the code / SKU / barcode searchable. */
export const productOptions = (products = [], hintOf) =>
  products.map((p) => ({
    value: p.id,
    label: p.name,
    hint: hintOf ? hintOf(p) : [p.sku || p.code, p.hint].filter(Boolean).join(' · '),
    keywords: [p.barcode, p.brand, p.code, p.sku].filter(Boolean).join(' '),
  }));

export default SearchSelect;
