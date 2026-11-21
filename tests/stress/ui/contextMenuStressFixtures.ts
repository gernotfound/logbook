import { vi } from 'vitest';
import { Pencil, Trash2, Copy } from 'lucide-react';
import type { ContextMenuItem } from '../../../src/components/UI/ContextMenu';

export const createContextMenuStressItems = (): ContextMenuItem[] => [
  { id: 'item-1', label: 'Modifica scheda', icon: Pencil, onClick: vi.fn() },
  { id: 'item-2', label: 'Duplica scheda', icon: Copy, onClick: vi.fn() },
  { id: 'item-3', label: 'Elimina scheda', icon: Trash2, variant: 'danger', onClick: vi.fn() },
];
