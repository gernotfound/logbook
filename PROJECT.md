# Project: Unified Telemetry Hub

## Architecture
The Unified Telemetry Hub provides centralized, privacy-first, offline-resilient telemetry for LogBook.
- **Core Hub & Sanitizer (`src/lib/telemetryHub.ts`, `src/lib/telemetrySanitizer.ts`)**:
  - Central singleton managing error and event dispatch.
  - Strict privacy engine: stack trace truncation (≤1000 chars), PII scrubbing (emails, IPs, JWTs, API keys, local paths), payload sanitization.
  - Context extractor: `appVersion`, `platform` (`'ios' | 'ipados' | 'other'`), `displayMode` (`'standalone' | 'browser'`), `online` (`boolean`), `userId`, `sessionId`.
  - In-memory 60s sliding window deduplicator aggregating repeated errors into single documents with `count`, `firstSeen`, `lastSeen`.
  - Offline FIFO queue in `localStorage` (`'logbook_telemetry_queue'`, capped at 50 entries) with dynamic in-flight live filtering and auto-replay on `window.addEventListener('online')` and app bootstrap.
- **Error Tracking Channels**:
  - React 19 Root Callbacks (`onCaughtError`, `onUncaughtError`, `onRecoverableError`) via `createRoot` options in `src/main.tsx`.
  - Global Window Listeners (`window.onerror`, `window.onunhandledrejection`).
  - Zod Validation Discards (`DomainParsers` in `src/lib/schema.ts`, `errorHandler.ts`).
- **PWA Analytics & Offline Usage**:
  - PWA Install Funnel: `beforeinstallprompt` (impression), custom button click (`pwa_install_click`), prompt outcome (`accepted` / `dismissed`), native `appinstalled`.
  - Offline Workout Lifecycle: Tracking `workout_started` and `workout_saved` with `{ offline: boolean }` in `useWorkoutSession.ts`.
- **Firestore Subcollections & Security Rules**:
  - `users/{userId}/telemetry_errors/{errorId}`
  - `users/{userId}/telemetry_events/{eventId}`
  - Protected by `isOwner(userId)` and strict whitelist schemas in `firestore.rules`.
  - Cascading deletion supported via `DB.deleteAccount`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Telemetry Context Provider | Captures appVersion, derived platform, displayMode, online status, userId, sessionId | M1 | Survey |
| F2 | Privacy Sanitization Engine | Truncates stack traces to ≤1000 chars, scrubs emails, IPs, tokens, local paths, prevents PII leakage | M1 | Survey |
| F3 | Error Tracking Core & Dedup | Hashes (type+message), 60s sliding rate limit, aggregates count/firstSeen/lastSeen | M1 | Survey |
| F4 | React 19 Root Error Interception | Hooks onCaughtError, onUncaughtError, onRecoverableError in createRoot | M3 | Survey |
| F5 | Global Window Error Interception | Intercepts window.onerror and window.onunhandledrejection non-blockingly | M1 | Survey |
| F6 | Zod Validation Error Tracking | Hooks DomainParsers schema validation fallbacks without leaking user payload | M3 | Survey |
| F7 | PWA Install Funnel Analytics | Tracks beforeinstallprompt, install button click, prompt outcome, and appinstalled | M2 | Survey |
| F8 | Offline Workout Usage Analytics | Tracks workout_started and workout_saved with offline: boolean metadata | M2 | Survey |
| F9 | Offline Queue & Replay Engine | Local FIFO buffer in localStorage, replaying queued events on window 'online' event | M2 | Survey |
| F10 | Firestore Rules & Schema Whitelists | Subcollections under users/{uid} with isOwner checks and exact key whitelists | M3 | Survey |
| F11 | Telemetry Query Documentation | Guide on querying and filtering telemetry errors/events in Firestore | M3 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite | Comprehensive test suite (Tiers 1-4, 121 tests authored) and `TEST_READY.md` | none | DONE |
| M1 | Telemetry Hub Core & Error Dedup | `telemetrySanitizer.ts`, `telemetryHub.ts` core, hashing, 60s rate limit, sanitization | none | DONE |
| M2 | PWA Analytics & Offline Replay | PWA install funnel, offline workout hooks, localStorage FIFO queue and online replay | M1 | DONE |
| M3 | Integration & Firestore Rules | `main.tsx` React 19 root, `schema.ts`, `firestore.rules`, rules tests, documentation | M1, M2 | IN_PROGRESS |
| M4 | Final Milestone (100% E2E Pass & Tier 5) | Pass 100% E2E tests, Adversarial Hardening (Tier 5), Forensic Integrity Audit | E2E, M3 | PLANNED |

## Interface Contracts
### `telemetrySanitizer.ts` ↔ `telemetryHub.ts`
- `scrubPII(text: string): string`
- `truncateStack(stack?: string, maxLength?: number): string | undefined`
- `getTelemetryContext(): TelemetryContext`

### `telemetryHub.ts` ↔ Application (main.tsx, schema.ts, useWorkoutSession.ts, usePWAInstall.ts)
- `telemetryHub.init(): void`
- `telemetryHub.trackError(error: unknown, options?: { source?: ErrorSource; componentStack?: string; customMessage?: string }): void`
- `telemetryHub.trackEvent(type: TelemetryEventType, details?: Record<string, any>): void`
- `telemetryHub.flushQueue(): Promise<void>`
- `telemetryHub.getQueuedEvents(): QueuedTelemetryItem[]`

## Code Layout
- `src/lib/telemetrySanitizer.ts` (Sanitization, PII scrubbing, context probing)
- `src/lib/telemetryHub.ts` (Core hub, dedup, queue, Firestore dispatch, replay)
- `src/main.tsx` (React 19 root options & telemetry init)
- `src/lib/schema.ts` (DomainParsers fallback hook)
- `src/hooks/usePWAInstall.ts` (PWA install event routing)
- `src/components/SettingsView.tsx` (Install button telemetry trigger)
- `src/hooks/useWorkoutSession.ts` (Offline workout start/save telemetry)
- `firestore.rules` (Security rules for telemetry_errors and telemetry_events)
- `docs/TELEMETRY_FIRESTORE_QUERIES.md` (Operational documentation)
- `tests/telemetry_hub.test.ts` (Unit & integration test suite)
- `tests/telemetry_e2e.test.ts` (Opaque-box E2E test suite covering Tiers 1-4)
