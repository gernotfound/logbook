import { useEffect, useState } from 'react';
import { Logic } from '../lib/logic';

export function useLocalToday(): string {
    const [today, setToday] = useState(() => Logic.getLocalDateString());
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const refresh = () => {
            clearTimeout(timer);
            setToday(Logic.getLocalDateString());
            const now = new Date();
            const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            timer = setTimeout(refresh, Math.max(50, next.getTime() - now.getTime() + 50));
        };
        refresh();
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
    }, []);
    return today;
}
