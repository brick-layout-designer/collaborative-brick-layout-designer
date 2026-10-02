// typescript-eslint drives the TypeScript compiler API, which TypeScript 7
// (the native compiler the repo builds with) no longer ships. Give the
// typescript-eslint packages their own TypeScript 6 instead of the
// workspace's 7, so linting works without touching the build's compiler.
const TS_FOR_LINT = '~6.0.3';
const usesTsApi = (name) =>
  name === 'typescript-eslint' || name.startsWith('@typescript-eslint/') || name === 'ts-api-utils';

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (usesTsApi(pkg.name) && pkg.peerDependencies && pkg.peerDependencies.typescript) {
        delete pkg.peerDependencies.typescript;
        if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: TS_FOR_LINT };
      }
      return pkg;
    },
  },
};
