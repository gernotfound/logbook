import { readBrowserValueStrict, writeBrowserValue } from './sync/browserStorage';

const guestMarker = 'logbook:v2:guest:health-consent-withdrawal';

export type GuestHealthConsentStatus = 'active' | 'withdrawn' | 'error';

export function getGuestHealthConsentStatus(): GuestHealthConsentStatus {
    try {
        const value = readBrowserValueStrict(guestMarker);
        if (value === null) return 'active';
        if (value === 'withdrawn') return 'withdrawn';
        return 'error';
    } catch {
        return 'error';
    }
}

export function markGuestHealthConsentWithdrawn(): void {
    writeBrowserValue(guestMarker, 'withdrawn');
}
