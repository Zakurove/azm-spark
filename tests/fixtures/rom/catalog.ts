/**
 * The range of motion fixtures kept on disk (tests/fixtures/rom/<movement>/<profile>/<case>.json),
 * each with the generator spec that makes it (product v7 contract 8.2, stream B, step B2).
 * tests/fixtures/catalog.ts spreads them into CATALOG, so tests/fixtures.test.ts checks every file
 * against its spec and the e2e FixturePoseSource plays them by name.
 *
 * Placeholder of step A5 (contract 1.3), filled by B2: no fixture yet.
 */
import type { CatalogEntry } from "../catalog";

export const ROM_CATALOG: CatalogEntry[] = [];
