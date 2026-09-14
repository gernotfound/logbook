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
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: '10px' }}>
            <input 
                type="text" 
                placeholder="Cerca per nome o marca..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={e => e.target.select()}
                style={{ 
                    width: '100%', 
                    margin: 0, 
                    height: '44px', 
                    paddingLeft: '14px', 
                    paddingRight: searchQuery ? '36px' : '14px',
                    fontSize: '16px',
                    borderRadius: '10px'
                }}
            />
            {searchQuery && (
                <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="btn-link"
                    style={{
                        position: 'absolute',
                        right: '8px',
                        color: 'var(--text-muted)',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    aria-label="Cancella ricerca"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            )}
        </div>
    );
};
