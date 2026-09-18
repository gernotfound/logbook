import React from 'react';
import { X } from 'lucide-react';

interface FoodArchiveSearchProps {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
}

export const FoodArchiveSearch: React.FC<FoodArchiveSearchProps> = ({
    searchQuery,
    setSearchQuery
}) => {
    return (
        <div className="tracking-search">
            <input type="search" aria-label="Cerca per nome o marca" placeholder="Cerca per nome o marca..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onFocus={e => e.target.select()} />
            {searchQuery && (
                <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="btn-icon"
                    aria-label="Cancella ricerca"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            )}
        </div>
    );
};
