import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MuscleModel from '../src/components/Training/MuscleModel';

describe('MuscleModel DOM identity', () => {
  it('keeps SVG ids unique across multiple mounted maps while preserving logical path ids', () => {
    const { container } = render(
      <>
        <MuscleModel selectedMuscles={['petto']} />
        <MuscleModel selectedMuscles={['petto']} />
      </>
    );
    const ids = Array.from(container.querySelectorAll<HTMLElement>('[id]')).map(node => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelectorAll('[data-muscle-path="chest-upper-left"]')).toHaveLength(2);
  });
});
