import { useEffect } from 'react';

let lockCount = 0;
let restoreBodyStyles: (() => void) | null = null;

export const useScrollLock = (isLocked: boolean = true) => {
    useEffect(() => {
        if (!isLocked) return;

        if (lockCount === 0) {
            const style = document.body.style;
            const previous = (property: string) => ({
                value: style.getPropertyValue(property),
                priority: style.getPropertyPriority(property),
            });
            const overflow = previous('overflow');
            const touchAction = previous('touch-action');

            // A nested dialog must not overwrite the page's original inline styles.
            restoreBodyStyles = () => {
                for (const [property, prior] of [
                    ['overflow', overflow],
                    ['touch-action', touchAction],
                ] as const) {
                    if (prior.value) {
                        style.setProperty(property, prior.value, prior.priority);
                    } else {
                        style.removeProperty(property);
                    }
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
