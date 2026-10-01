// https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Workspace packages (packages/core) are ESM TypeScript that import siblings as './x.js', which is what
// TypeScript's "bundler" resolution and Node expect. Metro resolves the literal path, so for relative
// '.js' imports inside packages/ drop the extension and let sourceExts find the '.ts' file.
// @even/core itself resolves through the npm workspace symlink; no watchFolders are needed because
// packages/ sits inside the project root.
const packagesDir = path.join(__dirname, 'packages') + path.sep;
const upstreamResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.startsWith(packagesDir)
  ) {
    return resolve(context, moduleName.slice(0, -'.js'.length), platform);
  }
  return resolve(context, moduleName, platform);
};

// The dev sync server (npm run dev:server, scripts/dev-server.sh) keeps a SQLite database under
// `${EVEN_DEV_SERVER_DATA:-~/Library/Caches/even-dev-server}` by default, but an older checkout or an
// explicit override can still put one at .dev/sync-server/ inside the project root. resolver.blockList also
// feeds Metro's file-map ignorePattern, so without this, every sync push rewrites a file Metro is watching
// and the app shows a Fast Refresh "Refreshing…" banner after each one. Block the whole .dev/ folder.
const devDataDir = path.join(__dirname, '.dev') + path.sep;
const devDataPattern = new RegExp(`^${devDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const defaultBlockList = config.resolver.blockList;
const blockListPatterns = Array.isArray(defaultBlockList)
  ? defaultBlockList
  : defaultBlockList
    ? [defaultBlockList]
    : [];
config.resolver.blockList = [...blockListPatterns, devDataPattern];

module.exports = config;
