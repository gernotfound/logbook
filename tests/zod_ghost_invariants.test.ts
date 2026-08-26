import { describe, it, expect } from 'vitest';
import { DomainParsers } from '../src/lib/schema';
import type { CatalogFood } from '../src/types';

describe('DomainParsers Invariants: Ghost Object Prevention', () => {
    it('parseLibrary: scarta valori irrecuperabili e ghost objects', () => {
        const input = [
            { id: 'ex1', name: 'Valido', setsCount: 3 },
            null,
            'stringa_corrotta',
            123,
            true,
            { id: '', name: 'ID Vuoto' },
            { id: '   ', name: 'ID Spazi' },
            { name: 'Senza ID' }, // id `undefined` diventa ghost object in ExerciseSchema
        ];
        
        const result = DomainParsers.parseLibrary(input);
        
        // Deve rimanere SOLO l'elemento valido. NESSUNA eccezione lanciata.
        expect(result.map(item => item.id)).toEqual(['ex1']);
    });

    it('parseLibrary: sanitizza e conserva elementi con ID valido ma campi parzialmente corrotti', () => {
        const input = [
            { id: 'ex2', name: true }, // name invalido (boolean), dovrà essere sanitizzato a ''
            { id: 'ex3', extraProp: 'foo' } // name mancante, proprietà extra mantenuta
        ];
        
        const result = DomainParsers.parseLibrary(input);
        
        expect(result.map(item => item.id)).toEqual(['ex2', 'ex3']);
        expect(result[0].name).toBe('');
        expect(result[1].name).toBe('');
        // @ts-ignore testing passthrough
        expect(result[1].extraProp).toBe('foo');
    });

    it('parseCustomFoods: scarta valori irrecuperabili e ghost objects', () => {
        // Usa una fixture realistica per FoodSchema
        const validFood: CatalogFood = {
            id: 'food1',
            name: 'Mela',
            kcal: 50,
            pro: 0.3,
            carbs: 14,
            fat: 0.2
        };

        const input = [
            validFood,
            null,
            { id: '', name: 'ID Vuoto' },
            { id: '   ', name: 'ID Spazi' },
            { name: 'Senza ID' }
        ];

        const result = DomainParsers.parseCustomFoods(input);

        expect(result.map(item => item.id)).toEqual(['food1']);
    });
});
