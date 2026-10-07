import { useState } from 'react';
import { Minus, Pause, Play, Plus } from 'lucide-react';
import { useMetronome } from '../../hooks/useMetronome';

const MIN_BPM = 30;
const MAX_BPM = 240;
const DEFAULT_BPM = 120;

const clampBpm = (value: number): number => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));

export default function WorkoutMetronome() {
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [bpmInput, setBpmInput] = useState(String(DEFAULT_BPM));
    const controller = useMetronome(bpm);

    const applyBpm = (value: number) => {
        const next = clampBpm(Number.isFinite(value) ? value : bpm);
        setBpm(next);
        setBpmInput(String(next));
    };

    const handleInputChange = (value: string) => {
        setBpmInput(value);
        const parsed = Number(value);
        if (value.trim() !== '' && Number.isFinite(parsed) && parsed >= MIN_BPM && parsed <= MAX_BPM) {
            setBpm(Math.round(parsed));
        }
    };

    return (
        <section className="workout-metronome-panel" aria-label="Metronomo">
            <div className="workout-metronome-heading">
                <strong>Metronomo</strong>
                <output aria-live="polite" aria-label="Velocità metronomo">{bpm} BPM</output>
            </div>

            <div className="workout-metronome-controls">
                <button type="button" className="workout-metronome-step" onClick={() => applyBpm(bpm - 1)} disabled={bpm <= MIN_BPM} aria-label="Riduci BPM">
                    <Minus size={20} aria-hidden="true" />
                </button>

                <label className="workout-metronome-input">
                    <span className="sr-only">Battiti per minuto</span>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_BPM}
                        max={MAX_BPM}
                        step={1}
                        value={bpmInput}
                        onChange={event => handleInputChange(event.target.value)}
                        onBlur={() => applyBpm(Number(bpmInput))}
                        onKeyDown={event => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        aria-label="Battiti per minuto"
                    />
                </label>

                <button type="button" className="workout-metronome-step" onClick={() => applyBpm(bpm + 1)} disabled={bpm >= MAX_BPM} aria-label="Aumenta BPM">
                    <Plus size={20} aria-hidden="true" />
                </button>

                <button
                    type="button"
                    className={controller.isRunning ? 'workout-metronome-toggle is-running' : 'workout-metronome-toggle'}
                    onClick={() => controller.isRunning ? controller.stop() : controller.start()}
                    disabled={!controller.isSupported}
                    aria-pressed={controller.isRunning}
                >
                    {controller.isRunning ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                    <span>{controller.isRunning ? 'Ferma' : 'Avvia'}</span>
                </button>
            </div>

            {!controller.isSupported && <p className="workout-metronome-status">Audio non disponibile su questo dispositivo.</p>}
            {controller.error && controller.isSupported && <p className="workout-metronome-status">{controller.error}</p>}
        </section>
    );
}
