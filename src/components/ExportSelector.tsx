import { memo, useMemo, useState } from 'react';
import Fuse from 'fuse.js';

export type ExportSelection = 'all' | 'none' | string[];

export interface ExportSelectorItem {
    id: string;
    name: string;
}

interface ExportSelectorProps {
    title: string;
    items: ExportSelectorItem[];
    selection: ExportSelection;
    onChange: (value: ExportSelection) => void;
}

export const ExportSelector = memo(function ExportSelector({
    title,
    items,
    selection,
    onChange,
}: ExportSelectorProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const fuse = useMemo(() => new Fuse(items, { keys: ['name'], threshold: 0.3 }), [items]);
    const filteredItems = useMemo(() => {
        const query = searchQuery.trim();
        return query ? fuse.search(query).map(result => result.item) : items;
    }, [fuse, items, searchQuery]);
    const selectedIds = Array.isArray(selection) ? selection : [];
    const isCustom = Array.isArray(selection);

    return (
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 15px 0', minWidth: 0 }}>
            <legend style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
                {title}
            </legend>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.95rem', color: 'var(--text-main)', minWidth: 0 }}>{title}</span>
                <select
                    aria-label={`Modalità selezione ${title}`}
                    value={selection === 'all' ? 'all' : selection === 'none' ? 'none' : 'custom'}
                    onChange={(event) => {
                        if (event.target.value === 'all') onChange('all');
                        else if (event.target.value === 'none') onChange('none');
                        else onChange([]);
                    }}
                    style={{ background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '6px', padding: '8px', fontSize: '16px', minHeight: '44px' }}
                >
                    <option value="all">Tutti ({items.length})</option>
                    <option value="custom">Seleziona...</option>
                    <option value="none">Nessuno</option>
                </select>
            </div>

            {isCustom && (
                <div style={{ border: '1px solid var(--glass-border)', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', padding: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {selectedIds.length} selezionati su {items.length}
                        </span>
                        {items.length > 5 && (
                            <input
                                type="search"
                                aria-label={`Cerca in ${title}`}
                                placeholder="Cerca..."
                                value={searchQuery}
                                onChange={event => setSearchQuery(event.target.value)}
                                style={{ width: '150px', maxWidth: '100%', padding: '8px', fontSize: '16px', minHeight: '44px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '6px', color: 'var(--text-main)' }}
                            />
                        )}
                    </div>

                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {filteredItems.length === 0 ? (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '8px 0' }}>Nessun elemento</span>
                        ) : filteredItems.map(item => (
                            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', fontSize: '0.9rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    aria-label={item.name}
                                    checked={selectedIds.includes(item.id)}
                                    onChange={event => {
                                        if (event.target.checked) onChange([...selectedIds, item.id]);
                                        else onChange(selectedIds.filter(id => id !== item.id));
                                    }}
                                    style={{ width: '20px', height: '20px', accentColor: 'var(--primary-color)' }}
                                />
                                <span style={{ minWidth: 0 }}>{item.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </fieldset>
    );
});
