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

export const MAX_CANDIDATE_DOCUMENT_BYTES = 950_000;
const BATCH_BYTES = 8 * MAX_CANDIDATE_DOCUMENT_BYTES + 8_192;
const withBodyCap = (scope, maxBodyBytes) => Object.freeze({ ...scope, maxBodyBytes });

const ROUTES = Object.freeze({
  '/v1/sync/control': withBodyCap(FITNESS_READ, 128),
  '/v1/sync/read': withBodyCap(FITNESS_READ, 512),
  '/v1/sync/scan': withBodyCap(FITNESS_READ, 256),
  '/v1/sync/receipt': withBodyCap(FITNESS_READ, 256),
  '/v1/sync/commit': withBodyCap(FITNESS_WRITE, BATCH_BYTES),
  '/v1/sync/commit/status': withBodyCap(FITNESS_WRITE, 512),
  '/v1/sync/replica/claim': withBodyCap(FITNESS_WRITE, 4_096),
  '/v1/sync/replica/retire': withBodyCap(FITNESS_WRITE, 4_096),
  '/v1/sync/replica/status': withBodyCap(FITNESS_WRITE, 4_096),
  '/v1/sync/replica/cancel': withBodyCap(FITNESS_WRITE, 4_096),
  '/v1/cloud-key/sync': withBodyCap(FITNESS_WRITE, 0),
  '/v1/cloud-key/recovery-inspect': withBodyCap(FITNESS_WRITE, 0),
  '/v1/consent/status': withBodyCap(IDENTITY_READ, 0),
  '/v1/consent/initial': withBodyCap(INITIAL_CONSENT, 2_048),
  '/v1/consent/withdraw': withBodyCap(IDENTITY_WRITE, 2_048),
  '/v1/cloud-key/rights-export': withBodyCap(IDENTITY_WRITE, 0),
  '/v1/rights/scan': withBodyCap(IDENTITY_WRITE, 256),
  '/v1/account/activity': withBodyCap(IDENTITY_WRITE, 128),
  '/v1/auth/logout': withBodyCap(INTERNAL_IDENTITY_WRITE, 0),
});
export const CANDIDATE_API_ROUTE_PATHS = Object.freeze(Object.keys(ROUTES));

export function candidateApiRoutePolicy(path) {
  return Object.hasOwn(ROUTES, path) ? ROUTES[path] : null;
}
