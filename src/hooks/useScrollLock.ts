import { useEffect } from 'react';

// Counter per gestire sovrapposizioni (es. Privacy Policy sopra Consent Overlay)
let lockCount = 0;

export const useScrollLock = (isLocked: boolean = true) => {
    useEffect(() => {
        if (!isLocked) return;

        lockCount++;
        if (lockCount === 1) {
            document.body.style.overflow = 'hidden';
            document.body.style.touchAction = 'none'; // Previene bounce su iOS
        }

        return () => {
            lockCount--;
            if (lockCount === 0) {
                document.body.style.overflow = '';
                document.body.style.touchAction = '';
            }
        };
    }, [isLocked]);
};
