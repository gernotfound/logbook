import { storage } from './firebase-config.js';
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
export const StorageManager = {
    async uploadPhoto(file, userId, dateStr) {
        if (!storage) throw new Error("Storage non inizializzato");
        if (!file) throw new Error("Nessun file selezionato");
        const fileExt = file.name.split('.').pop();
        const filePath = `users/${userId}/photos/${dateStr}.${fileExt}`;
        const storageRef = ref(storage, filePath);
        document.getElementById('sync-overlay').style.display = 'flex';
        try {
            console.log("Inizio upload foto:", filePath);
            const snapshot = await uploadBytes(storageRef, file);
            console.log("Upload completato");
            const downloadURL = await getDownloadURL(snapshot.ref);
            return downloadURL;
        } catch (error) {
            console.error("Errore upload foto:", error);
            throw error;
        } finally {
            document.getElementById('sync-overlay').style.display = 'none';
        }
    }
};
