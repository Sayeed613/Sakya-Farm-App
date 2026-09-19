const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Metro configuration for this app inside the pnpm workspace.
 *
 * The app imports `@sakya/api-client`, `@sakya/types`, `@sakya/utils` and
 * `@sakya/validation`, which are symlinked into `node_modules` rather than
 * downloaded. Three things have to be true for Metro to follow those links:
 *
 * 1. `watchFolders` includes the workspace root, so editing a shared package
 *    triggers a reload instead of being invisible to the bundler.
 * 2. `nodeModulesPaths` lists the app first and the workspace root second, so a
 *    dependency hoisted to the root still resolves.
 * 3. Hierarchical lookup is disabled. Without it, Node's "walk up the tree"
 *    behaviour can find a second copy of `react` above the workspace and bundle
 *    it — which fails at runtime with "Invalid hook call".
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css', projectRoot });
