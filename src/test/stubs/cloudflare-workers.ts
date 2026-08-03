/*
 * Test stub for the `cloudflare:workers` virtual module, which only exists inside the
 * Workers runtime. `vitest.config.ts` aliases it here so code reading a binding can be
 * unit-tested at all
 *
 * `env` is empty on purpose: no binding is present outside a deployed Worker, so this is
 * the shape production code has to cope with, and a test that wants one assigns it
 */

export const env: Partial<Env> = {};
