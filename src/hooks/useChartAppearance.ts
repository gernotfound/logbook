import { useEffect, useMemo, useState } from 'react';
import { getChartColors, useAppearanceStore } from '../store/useAppearanceStore';

export function useChartAppearance() {
    const theme = useAppearanceStore(state => state.resolvedTheme);
    const colors = useMemo(() => ({ theme, ...getChartColors() }), [theme]);
    const [reducedMotion, setReducedMotion] = useState(() =>
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        if (typeof matchMedia !== 'function') return;
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReducedMotion(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return { colors, reducedMotion };
}
