import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface SubNavProps<T extends string> {
  id: string;
  label: string;
  items: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export default function SubNav<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
}: SubNavProps<T>) {
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const updateEdges = useCallback(() => {
    const node = list.current;
    if (!node) return;
    const start = node.scrollLeft > 2;
    const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 2;
    setEdges(current => current.start === start && current.end === end
      ? current
      : { start, end });
  }, []);

  useEffect(() => {
    const node = list.current;
    if (!node) return;

    const revealSelection = () => {
      const selected = node.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!selected || node.clientWidth === 0) return;
      const viewport = node.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();

      // Keep-alive views can regain their width after being shown. Only scroll
      // this list so restoring a sub-tab never changes the page position.
      if (tab.left < viewport.left) node.scrollLeft += tab.left - viewport.left;
      else if (tab.right > viewport.right) node.scrollLeft += tab.right - viewport.right;
      updateEdges();
    };

    revealSelection();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(revealSelection)
      : null;
    observer?.observe(node);
    window.addEventListener('resize', revealSelection);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', revealSelection);
    };
  }, [items, updateEdges, value]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (items.length === 0) return;
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;

    event.preventDefault();
    onChange(items[next].id);
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
      ?.focus({ preventScroll: true });
  };

  return (
    <div className="sub-nav-shell">
      <div
        className="sub-nav"
        ref={list}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onScroll={updateEdges}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`${id}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={value === item.id}
            tabIndex={value === item.id ? 0 : -1}
            className={`sub-nav-btn ${value === item.id ? 'active' : ''}`}
            onClick={() => onChange(item.id)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {edges.start && (
        <span className="sub-nav-edge sub-nav-edge-start" aria-hidden="true">
          <ChevronLeft size={16} />
        </span>
      )}
      {edges.end && (
        <span className="sub-nav-edge sub-nav-edge-end" aria-hidden="true">
          <ChevronRight size={16} />
        </span>
      )}
    </div>
  );
}
