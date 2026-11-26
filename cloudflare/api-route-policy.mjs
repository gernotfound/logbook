// One candidate route policy shared by the public D1 service-binding gateway
// and the private Auth Gate. Internal routes never become public merely
// because the Auth Gate can authorize them.
const FITNESS_READ = Object.freeze({ public: true, identityOnly: false,
  csrfRequired: false, emailVerifiedRequired: true });
const FITNESS_WRITE = Object.freeze({ public: true, identityOnly: false,
  csrfRequired: true, emailVerifiedRequired: true });
const IDENTITY_READ = Object.freeze({ public: true, identityOnly: true,
  csrfRequired: false, emailVerifiedRequired: false });
const IDENTITY_WRITE = Object.freeze({ public: true, identityOnly: true,
  csrfRequired: true, emailVerifiedRequired: false });
const INITIAL_CONSENT = Object.freeze({ public: true, identityOnly: true,
  csrfRequired: true, emailVerifiedRequired: true });
const INTERNAL_IDENTITY_WRITE = Object.freeze({ public: false, identityOnly: true,
  csrfRequired: true, emailVerifiedRequired: false });

const ROUTES = Object.freeze({
  '/v1/sync/control': FITNESS_READ,
  '/v1/sync/read': FITNESS_READ,
  '/v1/sync/scan': FITNESS_READ,
  '/v1/sync/receipt': FITNESS_READ,
  '/v1/sync/commit': FITNESS_WRITE,
  '/v1/sync/commit/status': FITNESS_WRITE,
  '/v1/sync/replica/claim': FITNESS_WRITE,
  '/v1/sync/replica/retire': FITNESS_WRITE,
  '/v1/sync/replica/status': FITNESS_WRITE,
  '/v1/sync/replica/cancel': FITNESS_WRITE,
  '/v1/cloud-key/sync': FITNESS_WRITE,
  '/v1/consent/status': IDENTITY_READ,
  '/v1/consent/initial': INITIAL_CONSENT,
  '/v1/consent/withdraw': IDENTITY_WRITE,
  '/v1/cloud-key/rights-export': IDENTITY_WRITE,
  '/v1/rights/scan': IDENTITY_WRITE,
  '/v1/account/activity': IDENTITY_WRITE,
  '/v1/auth/logout': INTERNAL_IDENTITY_WRITE,
});
export const CANDIDATE_API_ROUTE_PATHS = Object.freeze(Object.keys(ROUTES));

export function candidateApiRoutePolicy(path) {
  return Object.hasOwn(ROUTES, path) ? ROUTES[path] : null;
}
