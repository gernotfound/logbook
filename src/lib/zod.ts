/**
 * Zod bootstrap module — import `z` from here instead of directly from 'zod'.
 *
 * This module configures Zod before re-exporting it. Because ESM evaluates
 * modules bottom-up in the dependency graph, placing z.config() here ensures
 * it runs before any schema in any importing module is constructed — even
 * those built during module initialization.
 *
 * jitless: true — disables new Function() / eval() usage, complying with the
 * Content Security Policy (script-src without 'unsafe-eval').
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
