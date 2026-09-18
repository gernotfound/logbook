import { Scale } from 'lucide-react';

interface BiometryBentoCardProps {
    weightStats: { latestWeight?: number | null; weightDelta?: number | null } | null;
    bf: string | number;
}

export default function BiometryBentoCard({ weightStats, bf }: BiometryBentoCardProps) {
    const delta = weightStats?.weightDelta;
    return (
        <section className="home-biometry">
            <h2 className="home-section-heading"><Scale size={22} aria-hidden="true" />Biometria</h2>
            <dl className="home-biometry-values">
                <div><dt>Ultimo peso</dt><dd>{weightStats?.latestWeight ?? '--'} <span className="text-sm">{weightStats?.latestWeight ? 'kg' : ''}</span></dd>
                    {delta != null && delta !== 0 && <p className="text-sm home-muted">{delta > 0 ? '+' : ''}{delta.toFixed(1)} kg nel periodo</p>}
                </div>
                <div><dt>Massa grassa</dt><dd>{bf !== '--' ? `${bf} %` : '--'}</dd></div>
            </dl>
        </section>
    );
}
