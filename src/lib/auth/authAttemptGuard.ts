import { auth } from '../firebase';
import { captureSession, isCurrentSession } from '../sync/session';

/** Only for the pre-result/error phase: a successful sign-in changes Auth itself. */
export function captureAuthAttemptGuard(guestActive: boolean): () => boolean {
    const user = auth.currentUser;
    const session = captureSession();
    return () => {
        try {
            // The login screen has no active guest session to validate. Its
            // original null Auth identity and epoch still fence delayed errors.
            return auth.currentUser === user && captureSession().epoch === session.epoch
                && (!guestActive || isCurrentSession(session));
        } catch {
            return false;
        }
    };
}
