import { useEffect } from 'react';

let lockCount = 0;
let restoreBodyStyles: (() => void) | null = null;

export const useScrollLock = (isLocked: boolean = true) => {
    useEffect(() => {
        if (!isLocked) return;

        if (lockCount === 0) {
            const style = document.body.style;
            // Overflow is a shorthand: writing it can replace existing
            // overflow-x/overflow-y declarations and their priorities.
            const previous = (['overflow', 'overflow-x', 'overflow-y', 'touch-action'] as const)
                .map(property => ({
                    property,
                    value: style.getPropertyValue(property),
                    priority: style.getPropertyPriority(property),
                }));

            // Restore only the properties owned by this lock, never unrelated body styles.
            restoreBodyStyles = () => {
                for (const { property } of previous) style.removeProperty(property);
                for (const { property, value, priority } of previous) {
                    if (value) style.setProperty(property, value, priority);
                }
            };
            style.setProperty('overflow', 'hidden');
            style.setProperty('touch-action', 'none');
        }
        lockCount += 1;

        return () => {
            lockCount -= 1;
            if (lockCount === 0) {
                restoreBodyStyles?.();
                restoreBodyStyles = null;
            }
        };
    }, [isLocked]);
};
