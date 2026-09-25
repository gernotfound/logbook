import { Scale } from 'lucide-react';

interface BiometryBentoCardProps {
    weightStats: any;
    bf: string | number;
    bfSource?: string | null;
}

const BiometryBentoCard = ({ weightStats, bf, bfSource }: BiometryBentoCardProps) => {
    const delta = weightStats?.weightDelta;
    return (
        <section className="home-biometry">
            <h2 className="home-section-heading"><Scale size={22} aria-hidden="true" />Biometria</h2>
            <dl className="home-biometry-values">
                <div>
                    <dt>Ultimo peso</dt>
                    <dd>{weightStats?.latestWeight ?? '--'} <span className="text-sm">{weightStats?.latestWeight ? 'kg' : ''}</span></dd>
                    {delta != null && delta !== 0 && <p className="text-sm home-muted">{delta > 0 ? '+' : ''}{delta.toFixed(1)} kg nel periodo</p>}
                    {weightStats?.latestWeeklyAverage != null && (
                        <p className="text-sm home-muted">
                            Media settimana: {weightStats.latestWeeklyAverage.toFixed(1)} kg · {weightStats.latestWeeklyCoverage?.recordedDays ?? 0}/{weightStats.latestWeeklyCoverage?.daysConsidered ?? 0} giorni registrati
                        </p>
                    )}
                </div>
                <div>
                    <dt>Massa grassa</dt>
                    <dd>{bf !== '--' ? `${bf} %` : '--'}</dd>
                    {bf !== '--' && bfSource && <p className="text-sm home-muted">Fonte: {bfSource}</p>}
                </div>
            </dl>
        </section>
    );
};

export default BiometryBentoCard;
