/**
 * What PUT /api/intake runs after it saved an intake (product v7 contract 2.10, stream E): with
 * AZM_V7=1, the targeted weekly is rebuilt from the latest completed focus check, first dropping the
 * range findings whose region and side are no longer on the body map. server/api.ts calls it only
 * with the flag on and only after the save succeeded.
 *
 * Placeholder of step A5 (contract 1.3): it does nothing.
 */
import type { DatabaseSync } from "node:sqlite";

export function afterIntakeSaved(_db: DatabaseSync, _userId: string): void {}
