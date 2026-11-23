import { Plus, Search, Utensils } from 'lucide-react';
import type { useNutritionFoodArchive } from '../../hooks/useNutritionFoodArchive';
import CustomFoodForm from './CustomFoodForm';
import { FoodArchiveSearch } from './archive/FoodArchiveSearch';
import { FoodItemRow } from './archive/FoodItemRow';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

export function NutritionFoodArchiveForm({ editor }: { editor: ReturnType<typeof useNutritionFoodArchive> }) {
    const {
        customFoods, filteredFoods, visibleFoods, searchQuery, showModal, editingFoodId, cfData, setCfData, setShowModal,
        openCreateModal, openEditModal, closeModal, handleSaveFood, handleDuplicateFood, handleDeleteFood, handleQuickAddToMeal,
        updateSearchQuery, showMore,
    } = editor;

    return (
        <div>
            {/* Header & Create Button */}
            <div className="section-divider">
                <div className="flex-between mb-15 items-center">
                    <div>
                        <h1 className="m-0" style={{color: 'var(--text-main)'}}>🥗 Alimenti</h1>
                        <p className="text-muted text-base m-0 mt-4">
                            Gestisci, crea e consulta i tuoi alimenti personalizzati
                        </p>
                    </div>
                    {!showModal && (
                        <button
                            type="button"
                            className="btn btn-primary btn-small"
                            onClick={openCreateModal}
                            style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Plus size={16} aria-hidden="true" /> Crea alimento
                        </button>
                    )}
                </div>

                {/* Modal for create/edit */}
                <CustomFoodForm
                    cfData={cfData}
                    setCfData={setCfData}
                    saveCustomFood={handleSaveFood}
                    showCustomModal={showModal}
                    setShowCustomModal={setShowModal}
                    isEditing={editingFoodId !== null}
                    onCancel={closeModal}
                />

                {/* Search Bar */}
                <FoodArchiveSearch
                    searchQuery={searchQuery}
                    setSearchQuery={updateSearchQuery}
                />
            </div>

            {/* Food Items List */}
            <div className="section-divider-last">
                <div className="flex-between mb-10 pb-10 border-b">
                    <span className="text-sm font-bold text-muted">
                        I tuoi alimenti ({filteredFoods.length})
                    </span>
                </div>

                {customFoods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        <Utensils size={32} aria-hidden="true" style={{ marginBottom: '8px' }} />
                        <p className="m-0 text-sm font-semibold text-white">Nessun alimento presente.</p>
                        <p className="m-0 text-xs text-muted mt-4">
                            Clicca su <strong>+ Crea alimento</strong> in alto per iniziare a inserire i tuoi alimenti.
                        </p>
                    </div>
                ) : filteredFoods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        <Search size={32} aria-hidden="true" style={{ marginBottom: '8px' }} />
                        <p className="m-0 text-sm">Nessun alimento trovato per "{searchQuery}".</p>
                    </div>
                ) : (
                    <>
                    {visibleFoods.map((f, idx) => (
                        <FoodItemRow
                            key={f.id == null ? `unidentified:${idx}` : `${typeof f.id}:${f.id}`}
                            food={f}
                            isLast={idx === visibleFoods.length - 1}
                            mealTypes={MEAL_TYPES}
                            onEdit={openEditModal}
                            onDelete={handleDeleteFood}
                                onDuplicate={handleDuplicateFood}
                            onQuickAddToMeal={handleQuickAddToMeal}
                        />
                    ))}
                    {visibleFoods.length < filteredFoods.length && (
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={showMore}
                            aria-label={`Mostra altri alimenti (${filteredFoods.length - visibleFoods.length} rimanenti)`}
                        >
                            Mostra altri alimenti
                        </button>
                    )}
                    </>
                )}
            </div>
        </div>
    );
}
