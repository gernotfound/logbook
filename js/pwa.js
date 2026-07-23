export const PWA = {
    init() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                const hasControllerOnLoad = !!navigator.serviceWorker.controller;
                navigator.serviceWorker.register('sw.js')
                    .then(reg => {
                        console.log('Service Worker registrato con successo.', reg);
                        reg.addEventListener('updatefound', () => {
                            const newWorker = reg.installing;
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    this.showUpdateToast();
                                }
                            });
                        });
                    })
                    .catch(err => console.error('Errore registrazione SW:', err));
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (!refreshing) {
                        refreshing = true;
                        window.location.reload();
                    }
                });
            });
        }
    },
    showUpdateToast() {
        const toast = document.getElementById('update-toast');
        if (toast) {
            toast.classList.add('show');
            const btn = toast.querySelector('button');
            if (btn) {
                btn.onclick = () => {
                    if (navigator.serviceWorker.controller) {
                        navigator.serviceWorker.ready.then(reg => {
                            if (reg.waiting) {
                                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                            }
                        });
                    }
                };
            }
        }
    }
};
