import type { WheelEvent } from 'react';

export interface SectionTabOption<T extends string> {
  value: T;
  label: string;
  ariaLabel?: string;
}

interface SectionTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly SectionTabOption<T>[];
  ariaLabel: string;
  className?: string;
}

/**
 * Navigazione secondaria condivisa tra le aree dell'app.
 * Mantiene le classi legacy sub-nav/sub-nav-btn perché sono usate dagli E2E,
 * aggiungendo classi semantiche per il design system v2.
 */
export function SectionTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
  className = '',
}: SectionTabsProps<T>) {
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY !== 0) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  };

  return (
    <div
      className={`sub-nav section-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
      onWheel={handleWheel}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={tab.ariaLabel}
            className={`sub-nav-btn section-tab ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default SectionTabs;
