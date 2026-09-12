import { memo, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
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
        <fieldset className="export-selector">
            <legend className="sr-only">{title}</legend>
            <div className="export-selector__header">
                <div>
                    <span className="export-selector__title">{title}</span>
                    <span className="export-selector__summary">
                        {selection === 'all' ? `${items.length} elementi` : selection === 'none' ? 'Escluso' : `${selectedIds.length} di ${items.length} selezionati`}
                    </span>
                </div>
                <select
                    className="export-selector__mode"
                    aria-label={`Modalità selezione ${title}`}
                    value={selection === 'all' ? 'all' : selection === 'none' ? 'none' : 'custom'}
                    onChange={(event) => {
                        if (event.target.value === 'all') onChange('all');
                        else if (event.target.value === 'none') onChange('none');
                        else onChange([]);
                    }}
                >
                    <option value="all">Tutti</option>
                    <option value="custom">Seleziona</option>
                    <option value="none">Nessuno</option>
                </select>
            </div>

            {isCustom && (
                <div className="export-selector__panel">
                    {items.length > 5 && (
                        <label className="search-field export-selector__search">
                            <Search size={17} aria-hidden="true" />
                            <input
                                type="search"
                                aria-label={`Cerca in ${title}`}
                                placeholder="Cerca elemento"
                                value={searchQuery}
                                onChange={event => setSearchQuery(event.target.value)}
                            />
                        </label>
                    )}

                    <div className="export-selector__list">
                        {filteredItems.length === 0 ? (
                            <span className="export-selector__empty">Nessun elemento corrispondente.</span>
                        ) : filteredItems.map(item => {
                            const checked = selectedIds.includes(item.id);
                            return (
                                <label key={item.id} className={`export-selector__item ${checked ? 'is-selected' : ''}`}>
                                    <input
                                        type="checkbox"
                                        aria-label={item.name}
                                        checked={checked}
                                        onChange={event => {
                                            if (event.target.checked) onChange([...selectedIds, item.id]);
                                            else onChange(selectedIds.filter(id => id !== item.id));
                                        }}
                                    />
                                    <span className="export-selector__check" aria-hidden="true">
                                        {checked && <Check size={14} />}
                                    </span>
                                    <span className="export-selector__item-name">{item.name}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
        </fieldset>
    );
});
