import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Locate the repository root by walking up to the pnpm workspace manifest.
 *
 * Counting `..` segments is fragile: the answer changes with how deep the calling
 * file sits and with whether it is executed from source or from `dist`, and a
 * wrong count fails at runtime by looking for `migration/` in a directory that
 * does not have it. Anchoring on a file that only exists at the root is stable in
 * both cases.
 */
export function findRepositoryRoot(start: string): string {
  let current = start;

  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not locate the repository root (pnpm-workspace.yaml) above ${start}.`);
}

/** Resolved once at module load. Every migration script shares this. */
export const repositoryRoot = findRepositoryRoot(__dirname);

/**
 * Absolute path to something inside `migration/`.
 *
 * `migrationPath('normalized', 'catalog.json')` -> `<root>/migration/normalized/catalog.json`
 */
export function migrationPath(...segments: string[]): string {
  return join(repositoryRoot, 'migration', ...segments);
}
