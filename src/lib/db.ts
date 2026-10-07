import { auth, getDb, ensureAppCheck } from './firebase';
import {
    collection,
    doc,
    documentId,
    getDoc,
    getDocsFromServer,
    limit,
    orderBy,
    query,
    startAfter,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { UserData } from '../types';
import { DomainParsers } from './schema';
import { syncGlobalCatalog, getCachedCatalog } from './catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from './catalog/deltaResolver';
import { normalizeCloudDocument } from './schemaEvolution';
import { withTimeout, setLastSavedStateStr } from './db/db_core';
import { loadHistoryMonths } from './db/db_training';
import { loadNutritionMonths } from './db/db_nutrition';
import { sanitizeHistoryMonthDocument, sanitizeNutritionMonthDocument } from './sync/monthlyIntegrity';
import { assertWorkoutSessionIdentities } from './sync/domainOperations/validation';
import { DB as baseDB } from './_dbBase';

function parsePersistedActiveWorkout(value: unknown) {
    const parsed = DomainParsers.parseActiveWorkout(value);
    if (!parsed) return null;
    try {
        assertWorkoutSessionIdentities(parsed, 'Allenamento attivo cloud');
        return parsed;
    } catch {
        return null;
    }
}

async function loadCloudPayload(options?: { allMonths?: boolean }): Promise<{
    data: UserData;
    cloudDocuments: Map<string, any>;
    completeMonths: string[];
} | null> {
    const user = auth.currentUser;
    if (!user) return null;

    const cloudDocuments = new Map<string, any>();
    let completeMonths: string[] = [];
    const state: Record<string, any> = {
        profile: {},
        library: [],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        trainingCycles: [],
        activeCycleId: null,
        nutritionPlanning: null,
        supplements: [],
        activePains: [],
        legalConsent: null,
        catalogOverrides: {},
    };

    try {
        await ensureAppCheck();
        const db = getDb();
        const catalog = await getCachedCatalog();
        syncGlobalCatalog(db).catch(() => {});

        const root = await withTimeout(
            getDoc(doc(db, 'users', user.uid)),
            6000,
            'Timeout recupero profilo utente',
        );

        if (root && typeof root.exists === 'function' && root.exists()) {
            const normalizedRoot = normalizeCloudDocument(root.data(), 'Firestore root data schema');
            const data = normalizedRoot.business as Record<string, any>;
            cloudDocuments.set('', { ...data, _sync: normalizedRoot.sync });
            if (data.profile) state.profile = data.profile;
            state.catalogOverrides = data.catalogOverrides || {};
            state.library = resolveEffectiveExercises(catalog.exercises, data.library || [], state.catalogOverrides);
            state.customFoods = resolveEffectiveFoods(catalog.foods, data.customFoods || [], state.catalogOverrides);
            if (data.routines) state.routines = data.routines;
            if (data.activeWorkout !== undefined) state.activeWorkout = data.activeWorkout;
            if (data.trainingCycles) state.trainingCycles = data.trainingCycles;
            if (data.activeCycleId !== undefined) state.activeCycleId = data.activeCycleId;
            if (data.supplements) state.supplements = data.supplements;
            if (data.nutritionPlanning) state.nutritionPlanning = data.nutritionPlanning;
            state.nutritionPlanningOrigin =
                data.nutritionPlanningOrigin === 'generated-default' || data.nutritionPlanningOrigin === 'user-edited'
                    ? data.nutritionPlanningOrigin
                    : undefined;
            if (data.activePains) state.activePains = data.activePains;
            if (data.legalConsent) state.legalConsent = data.legalConsent;
        } else {
            // A Firestore parent document may be absent while its subcollections exist.
            // Initialize root defaults, then keep acquiring the requested monthly coverage.
            state.library = resolveEffectiveExercises(catalog.exercises, [], state.catalogOverrides);
            state.customFoods = resolveEffectiveFoods(catalog.foods, [], state.catalogOverrides);
        }

        if (options?.allMonths) {
            for (const colName of ['history_months', 'nutrition_months']) {
                let cursor: QueryDocumentSnapshot | undefined;
                do {
                    const constraints: any[] = [orderBy(documentId()), limit(400)];
                    if (cursor) constraints.push(startAfter(cursor));
                    const page = await withTimeout(
                        getDocsFromServer(query(collection(db, 'users', user.uid, colName), ...constraints)),
                        10000,
                        `Timeout recupero ${colName} completo`,
                    );
                    for (const item of page.docs) {
                        const normalized = normalizeCloudDocument(item.data(), `${colName}/${item.id} data schema`);
                        const rawMonthData = normalized.business as Record<string, any>;
                        const monthData = colName === 'history_months'
                            ? sanitizeHistoryMonthDocument(item.id, rawMonthData)
                            : sanitizeNutritionMonthDocument(item.id, rawMonthData);
                        cloudDocuments.set(`${colName}/${item.id}`, { ...monthData, _sync: normalized.sync });
                        if (!completeMonths.includes(item.id)) completeMonths.push(item.id);
                        if (colName === 'history_months') {
                            Object.values(monthData).forEach(historyItem => state.history.push(historyItem));
                        } else {
                            Object.entries(monthData).forEach(([date, day]) => {
                                state.nutrition[date] = day;
                            });
                        }
                    }
                    cursor = page.size === 400 ? page.docs[page.docs.length - 1] : undefined;
                } while (cursor);
            }
        } else {
            const now = new Date();
            const targetMonths = [0, 1, 2].map(offset => {
                const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            });
            await loadHistoryMonths(user, targetMonths, state, cloudDocuments);
            await loadNutritionMonths(user, targetMonths, state, cloudDocuments);
            completeMonths = targetMonths;
        }

        state.history.sort((a: any, b: any) => (b.globalStartTime || 0) - (a.globalStartTime || 0));
        state.profile = DomainParsers.parseProfile(state.profile);
        state.library = DomainParsers.parseLibrary(state.library);
        state.routines = DomainParsers.parseRoutines(state.routines);
        state.history = DomainParsers.parseHistory(state.history);
        state.nutrition = DomainParsers.parseNutrition(state.nutrition);
        state.customFoods = DomainParsers.parseCustomFoods(state.customFoods);
        state.trainingCycles = DomainParsers.parseTrainingCycles(state.trainingCycles);
        state.supplements = DomainParsers.parseSupplements(state.supplements);
        state.activePains = DomainParsers.parseActivePains(state.activePains);
        if (state.activeWorkout) state.activeWorkout = parsePersistedActiveWorkout(state.activeWorkout);
        if (state.nutritionPlanning) state.nutritionPlanning = DomainParsers.parseNutritionPlanning(state.nutritionPlanning);
        if (state.legalConsent) state.legalConsent = DomainParsers.parseLegalConsent(state.legalConsent);

        setLastSavedStateStr(JSON.stringify(state));
        return { data: state as UserData, cloudDocuments, completeMonths };
    } catch (error) {
        console.error('Errore caricamento dati dal cloud:', error);
        throw error;
    }
}

export const DB = {
    ...baseDB,
    loadCloudPayload,
    async loadUserData(options?: { allMonths?: boolean }): Promise<UserData | null> {
        const payload = await loadCloudPayload(options);
        return payload ? payload.data : null;
    },
};
