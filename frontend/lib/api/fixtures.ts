/**
 * Doc 01 §16 fixture-pack fallback, active only when `NEXT_PUBLIC_ATLAS_MOCK === "1"`.
 * The in-memory store lives in `mock-store.ts`; URL dispatch in `mock-router.ts`.
 */

export { getMockDb } from "./mock-access";
export { resolveMockRequest } from "./mock-router";
