import fs from 'node:fs';

function replaceOne(path, from, to) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one match, found ${count}`);
  fs.writeFileSync(path, source.replace(from, to), 'utf8');
}

replaceOne(
  'src/components/Nutrition/NutritionFoodArchive.tsx',
  `    const saveUserData = useAppStore(state => state.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);`,
);
replaceOne(
  'src/components/Nutrition/NutritionFoodArchive.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                const existing = (prev.customFoods || []) as any[];\n                const updatedCustomFoods = currentEditingId\n                    ? existing.map(f => f.id === currentEditingId ? { ...cleanData, id: currentEditingId } : f)\n                    : [...existing, { ...cleanData, id: Logic.generateId('food') }];\n                return { ...prev, customFoods: updatedCustomFoods };\n            });`,
  `            const id = currentEditingId ?? Logic.generateId('food');\n            await dispatchDomainOperation({ type: 'food.upsert', food: { ...cleanData, id } as any });`,
);
replaceOne(
  'src/components/Nutrition/NutritionFoodArchive.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                return {\n                    ...prev,\n                    customFoods: [...(prev.customFoods || []), duplicated]\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'food.upsert', food: duplicated });`,
);
replaceOne(
  'src/components/Nutrition/NutritionFoodArchive.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                const existing = (prev.customFoods || []) as any[];\n                return { ...prev, customFoods: existing.filter(f => f.id !== food.id) };\n            });`,
  `            await dispatchDomainOperation({ type: 'food.delete', id: food.id });`,
);
replaceOne(
  'src/components/Nutrition/NutritionFoodArchive.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return prev;\n                const todayNutrition = prev.nutrition?.[todayDateStr] || { \n                    date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] \n                };\n                const mealsList = (todayNutrition.meals || []) as any[];\n                const updatedMeals = [...mealsList, addedItem];\n\n                let totalKcal = 0, totalCarbs = 0, totalPro = 0, totalFat = 0;\n                updatedMeals.forEach((m: any) => {\n                    const qty = m.quantity ?? m.baseQty ?? 100;\n                    const base = m.baseQty ?? 100;\n                    const ratio = base > 0 ? qty / base : 1;\n                    totalKcal += (parseFloat(m.kcal) || 0) * ratio;\n                    totalCarbs += (parseFloat(m.carbs) || 0) * ratio;\n                    totalPro += (parseFloat(m.pro) || 0) * ratio;\n                    totalFat += (parseFloat(m.fat) || 0) * ratio;\n                });\n\n                const newNutritionDay = {\n                    ...todayNutrition,\n                    meals: updatedMeals,\n                    kcal: Math.round(totalKcal),\n                    carbs: Math.round(totalCarbs * 10) / 10,\n                    pro: Math.round(totalPro * 10) / 10,\n                    fat: Math.round(totalFat * 10) / 10\n                };\n\n                return {\n                    ...prev,\n                    nutrition: {\n                        ...(prev.nutrition || {}),\n                        [todayDateStr]: newNutritionDay\n                    }\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'nutrition-meal.upsert', date: todayDateStr, meal: addedItem });`,
);

replaceOne(
  'src/components/Nutrition/NutritionSupplements.tsx',
  `    const saveUserData = useAppStore(s => s.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(s => s.dispatchDomainOperation);`,
);
replaceOne(
  'src/components/Nutrition/NutritionSupplements.tsx',
  `            await saveUserData((prev: any) => {\n                if (!prev) return null;\n                return {\n                    ...prev,\n                    supplements: [...(prev.supplements || []), duplicated]\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'supplement.upsert', supplement: duplicated });`,
);

replaceOne(
  'src/components/Training/WorkoutReportModal.tsx',
  `    const saveUserData = useAppStore(state => state.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);`,
);
replaceOne(
  'src/components/Training/WorkoutReportModal.tsx',
  `            await saveUserData(prev => {\n                if (!prev) return prev;\n                return {\n                    ...prev,\n                    routines: [...(prev.routines || []), newRoutine]\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'routine.upsert', routine: newRoutine });`,
);

replaceOne(
  'src/components/Training/planning/TrainingPlanning.tsx',
  `    const saveUserData = useAppStore(state => state.saveUserData);`,
  `    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);`,
);
replaceOne(
  'src/components/Training/planning/TrainingPlanning.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return null;\n                const currentCycles = prev.trainingCycles || [];\n                const isUpdate = currentCycles.some(c => c.id === savedCycle.id);\n                const updatedCycles = isUpdate\n                    ? currentCycles.map(c => c.id === savedCycle.id ? savedCycle : c)\n                    : [...currentCycles, savedCycle];\n                const newActiveId = prev.activeCycleId !== undefined && prev.activeCycleId !== null\n                    ? prev.activeCycleId\n                    : (updatedCycles.length === 1 ? savedCycle.id : null);\n                return {\n                    ...prev,\n                    trainingCycles: updatedCycles,\n                    activeCycleId: newActiveId\n                };\n            });`,
  `            const isUpdate = trainingCycles.some(cycle => cycle.id === savedCycle.id);\n            const updatedCount = isUpdate ? trainingCycles.length : trainingCycles.length + 1;\n            const operations: any[] = [{ type: 'training-cycle.upsert', cycle: savedCycle }];\n            if (activeCycleId === null && updatedCount === 1) operations.push({ type: 'active-cycle.set', id: savedCycle.id });\n            await dispatchDomainOperation(operations);`,
);
replaceOne(
  'src/components/Training/planning/TrainingPlanning.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return null;\n                return {\n                    ...prev,\n                    activeCycleId: cycleId\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'active-cycle.set', id: cycleId });`,
);
replaceOne(
  'src/components/Training/planning/TrainingPlanning.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return null;\n                return {\n                    ...prev,\n                    activeCycleId: null\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'active-cycle.set', id: null });`,
);
replaceOne(
  'src/components/Training/planning/TrainingPlanning.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return null;\n                const currentCycles = prev.trainingCycles || [];\n                return {\n                    ...prev,\n                    trainingCycles: [...currentCycles, duplicated]\n                };\n            });`,
  `            await dispatchDomainOperation({ type: 'training-cycle.upsert', cycle: duplicated });`,
);
replaceOne(
  'src/components/Training/planning/TrainingPlanning.tsx',
  `            await saveUserData((prev) => {\n                if (!prev) return null;\n                const currentCycles = prev.trainingCycles || [];\n                const updatedCycles = currentCycles.filter(c => c.id !== cycle.id);\n                const nextActiveId = prev.activeCycleId === cycle.id \n                    ? (updatedCycles.length > 0 ? updatedCycles[0].id : null) \n                    : prev.activeCycleId;\n                return {\n                    ...prev,\n                    trainingCycles: updatedCycles,\n                    activeCycleId: nextActiveId\n                };\n            });`,
  `            const remaining = trainingCycles.filter(item => item.id !== cycle.id);\n            const operations: any[] = [{ type: 'training-cycle.delete', id: cycle.id }];\n            if (activeCycleId === cycle.id) operations.push({ type: 'active-cycle.set', id: remaining[0]?.id ?? null });\n            await dispatchDomainOperation(operations);`,
);

replaceOne(
  'src/store/slices/createDataSlice.ts',
  `            const result = await state.updateUserData(prev => ({\n                ...prev, nutritionPlanning: localPlan, nutritionPlanningOrigin: 'user-edited',\n            }));`,
  `            const result = await state.dispatchDomainOperation({\n                type: 'nutrition-planning.replace',\n                value: localPlan,\n                origin: 'user-edited',\n            });`,
);

console.log('M8 final consumer migration applied');
