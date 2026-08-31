import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type ContextMenuItemVariant = 'default' | 'danger' | 'primary';

export interface ContextMenuItem {
  /** Identificativo univoco della voce */
  id?: string;
  /** Etichetta visibile in sentence case italiano (es. "Modifica ciclo", "Elimina scheda") */
  label: string;
  /** Icona Lucide (componente o elemento React) */
  icon?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }> | React.ReactNode;
  /** Handler scatenato al click */
  onClick: (e: React.MouseEvent) => void;
  /** Variante visiva: default (bianco/grigio), danger (rosso distruttivo), primary (cyan) */
  variant?: ContextMenuItemVariant;
  /** Stato disabilitato */
  disabled?: boolean;
  /** Condizione di visibilità (se true, la voce viene esclusa dal rendering) */
  hidden?: boolean;
  /** Tooltip accessibile o titolo opzionale */
  title?: string;
  /** Label accessibile opzionale */
  'aria-label'?: string;
}

export interface ContextMenuProps {
  /** Voci del menu a tendina */
  items: ContextMenuItem[];
  /** Label accessibile per lo screen reader e trigger (default: "Opzioni") */
  ariaLabel?: string;
  /** Titolo opzionale per il tooltip del pulsante trigger */
  triggerTitle?: string;
  /** Classe CSS aggiuntiva per il pulsante trigger */
  triggerClassName?: string;
  /** Classe CSS aggiuntiva per il contenitore */
  className?: string;
  /** Allineamento orizzontale del dropdown (default: 'right') */
  align?: 'right' | 'left';
  /** Stile inline per il container */
  style?: React.CSSProperties;
  /** Callback opzionale al cambio dello stato di apertura */
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * Helper per il rendering dell'icona supportando sia React Element sia React ComponentType
 */
const renderIcon = (icon: ContextMenuItem['icon']) => {
  if (!icon) return null;
  if (React.isValidElement(icon)) {
    return icon;
  }
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && 'render' in icon)) {
    const IconComp = icon as React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
    return <IconComp size={16} />;
  }
  return icon as React.ReactNode;
};

export const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  ariaLabel = 'Opzioni',
  triggerTitle,
  triggerClassName = '',
  className = '',
  align = 'right',
  style,
  onOpenChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Filtra elementi visibili
  const visibleItems = items.filter(item => !item.hidden);

  const toggleOpen = useCallback((openState?: boolean) => {
    setIsOpen(prev => {
      const next = openState !== undefined ? openState : !prev;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  // Gestione click outside (mousedown + touchstart)
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        toggleOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen, toggleOpen]);

  // Gestione tasto Escape globale
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        toggleOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isOpen, toggleOpen]);

  const getItemButtons = (): HTMLButtonElement[] => {
    if (!menuRef.current) return [];
    return Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'));
  };

  const focusNextItem = (direction: 1 | -1) => {
    const buttons = getItemButtons();
    if (buttons.length === 0) return;
    const activeEl = document.activeElement as HTMLButtonElement;
    const currentIndex = buttons.indexOf(activeEl);
    if (currentIndex === -1) {
      if (direction === 1) {
        buttons[0]?.focus();
      } else {
        buttons[buttons.length - 1]?.focus();
      }
    } else {
      const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    }
  };

  const focusItemIndex = (index: number) => {
    const buttons = getItemButtons();
    if (buttons.length === 0) return;
    const targetIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[targetIndex]?.focus();
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggleOpen();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (!isOpen) {
        e.preventDefault();
        e.stopPropagation();
        toggleOpen(true);
        setTimeout(() => {
          const buttons = getItemButtons();
          buttons[0]?.focus();
        }, 0);
      }
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) {
        e.preventDefault();
        e.stopPropagation();
        toggleOpen(true);
        setTimeout(() => {
          const buttons = getItemButtons();
          buttons[buttons.length - 1]?.focus();
        }, 0);
      }
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      focusNextItem(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      focusNextItem(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      focusItemIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const buttons = getItemButtons();
      focusItemIndex(buttons.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      toggleOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      toggleOpen(false);
    }
  };

  const handleItemClick = (e: React.MouseEvent, item: ContextMenuItem) => {
    e.stopPropagation();
    e.preventDefault();
    if (item.disabled) return;
    toggleOpen(false);
    item.onClick(e);
  };

  if (visibleItems.length === 0) return null;

  const resolvedTriggerTitle = triggerTitle || ariaLabel;
  const containerClassName = `context-menu-container ${className}`.trim();
  const triggerBtnClassName = `context-menu-trigger ${triggerClassName}`.trim();
  const dropdownClassName = `context-menu-dropdown ${align === 'left' ? 'align-left' : 'align-right'}`;

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={style}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerBtnClassName}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={resolvedTriggerTitle}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <MoreHorizontal size={20} />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          className={dropdownClassName}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          {visibleItems.map((item, idx) => {
            const isDanger = item.variant === 'danger';
            const isPrimary = item.variant === 'primary';
            const itemKey = item.id || `menu-item-${idx}`;

            const itemClassNames = [
              'context-menu-item',
              isDanger ? 'context-menu-item-danger item-danger' : '',
              isPrimary ? 'context-menu-item-primary item-primary' : '',
              item.disabled ? 'context-menu-item-disabled item-disabled' : ''
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={itemKey}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                aria-disabled={item.disabled}
                title={item.title || item.label}
                aria-label={item['aria-label'] || item.title || item.label}
                className={itemClassNames}
                onClick={(e) => handleItemClick(e, item)}
              >
                {item.icon && (
                  <span className="context-menu-item-icon" aria-hidden="true">
                    {renderIcon(item.icon)}
                  </span>
                )}
                <span className="context-menu-item-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
