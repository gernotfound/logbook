import { useAuth } from '../contexts/AuthContext';

export function useTrainingHistory() {
    const { userData, saveUserData } = useAuth();
    
    const history = [...(userData?.history || [])].sort((a,b) => (b.globalStartTime || 0) - (a.globalStartTime || 0));

    const deleteWorkout = (id) => {
        if (confirm("Eliminare definitivamente questo allenamento dallo storico?")) {
            const updatedHistory = (userData.history || []).filter(w => w.id !== id);
            saveUserData({ ...userData, history: updatedHistory });
        }
    };

    return {
        userData, history, deleteWorkout
    };
}
