import type { useNutritionSupplementEditor } from '../../hooks/useNutritionSupplementEditor';
import { NutritionDateNavigator } from './meals/NutritionDateNavigator';
import { SupplementCard } from './SupplementCard';
import { SupplementEditorForm } from './SupplementEditorForm';

export function NutritionSupplementsForm({
    editor, date, setSelectedDate,
}: {
    editor: ReturnType<typeof useNutritionSupplementEditor>;
    date: string;
    setSelectedDate?: (date: string) => void;
}) {
    return (
        <div>
            {setSelectedDate && <NutritionDateNavigator targetDateStr={date} setSelectedDate={setSelectedDate} />}
            {editor.showForm
                ? <SupplementEditorForm editing={editor.editing} form={editor.form} disabled={editor.saving}
                    onChange={editor.changeForm} onCancel={editor.closeForm} onSave={() => { void editor.save(); }} />
                : <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: '15px' }}
                    onClick={() => editor.openForm()}>+ Nuovo integratore</button>}

            {editor.sortedSupplements.length === 0
                ? <p className="text-muted text-center my-20">Non hai ancora aggiunto alcun integratore. Creane uno per iniziare a tracciarlo.</p>
                : editor.sortedSupplements.map(supplement => (
                    <SupplementCard key={supplement.id} supplement={supplement}
                        intakes={editor.intakesBySupplement.get(supplement.id) ?? []}
                        quickInput={editor.quickInputs[supplement.id]}
                        onQuickInputChange={value => editor.changeQuickInput(supplement.id, value)}
                        onEdit={() => editor.openForm(supplement)}
                        onDuplicate={() => editor.duplicate(supplement)}
                        onDelete={() => editor.removeSupplement(supplement.id)}
                        onAddIntake={() => editor.recordIntake(supplement)}
                        onRemoveIntake={editor.removeIntake} />
                ))}
        </div>
    );
}
