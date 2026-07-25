import React, { useState } from 'react';
import TrainingSession from './TrainingSession';
import TrainingRoutines from './TrainingRoutines';
import TrainingExercises from './TrainingExercises';
import TrainingHistory from './TrainingHistory';

const TrainingView = () => {
    const [subTab, setSubTab] = useState('session');

    return (
        <div id="view-training" className="view-section active">
            <div className="sub-nav">
                <div className={`sub-nav-btn ${subTab === 'session' ? 'active' : ''}`} onClick={() => setSubTab('session')}>Sessione</div>
                <div className={`sub-nav-btn ${subTab === 'routines' ? 'active' : ''}`} onClick={() => setSubTab('routines')}>Schede</div>
                <div className={`sub-nav-btn ${subTab === 'exercises' ? 'active' : ''}`} onClick={() => setSubTab('exercises')}>Esercizi</div>
                <div className={`sub-nav-btn ${subTab === 'history' ? 'active' : ''}`} onClick={() => setSubTab('history')}>Storico</div>
            </div>

            {subTab === 'session' && <TrainingSession />}
            {subTab === 'routines' && <TrainingRoutines />}
            {subTab === 'exercises' && <TrainingExercises />}
            {subTab === 'history' && <TrainingHistory />}
        </div>
    );
};

export default TrainingView;
