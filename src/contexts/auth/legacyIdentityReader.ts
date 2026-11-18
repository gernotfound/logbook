import { auth } from '../../lib/firebase';

// Stable reader shared by the mounted legacy provider and synthetic fixtures.
// Importing this module alone must not claim the realm's authenticated owner.
export const readLegacyAuthenticatedIdentity = () => auth.currentUser;
