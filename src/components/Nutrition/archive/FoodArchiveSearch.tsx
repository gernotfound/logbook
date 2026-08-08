import React from 'react';

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
                    style={{
                        position: 'absolute',
                        right: '8px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    aria-label="Cancella ricerca"
                >
                    ✕
                </button>
            )}
        </div>
    );
};
