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

module.exports = config;
