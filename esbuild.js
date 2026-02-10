const esbuild = require('esbuild');
const glob = require('glob');
const path = require('path');
const polyfill = require('@esbuild-plugins/node-globals-polyfill');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const desktop = process.argv.includes('--desktop');
const web = process.argv.includes('--web');

/**
 * This plugin hooks into the build process to print errors in a format that the problem matcher in
 * Visual Studio Code can understand.
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log('[watch] build finished');
    });
  },
};

/**
 * For web extension, all tests, including the test runner, need to be bundled into
 * a single module that has a exported `run` function .
 * This plugin bundles implements a virtual file extensionTests.ts that bundles all these together.
 * @type {import('esbuild').Plugin}
 */
const testBundlePlugin = {
  name: 'testBundlePlugin',
  setup(build) {
    build.onResolve({ filter: /[\/\\]extensionTests\.ts$/ }, (args) => {
      if (args.kind === 'entry-point') {
        return { path: path.resolve(args.path) };
      }
    });
    build.onLoad({ filter: /[\/\\]extensionTests\.ts$/ }, async (args) => {
      const testsRoot = path.join(__dirname, 'src/web/test/suite');
      const files = await glob.glob('*.test.{ts,tsx}', {
        cwd: testsRoot,
        posix: true,
      });
      return {
        contents:
          `export { run } from './mochaTestRunner.ts';` +
          files.map((f) => `import('./${f}');`).join(''),
        watchDirs: files.map((f) => path.dirname(path.resolve(testsRoot, f))),
        watchFiles: files.map((f) => path.resolve(testsRoot, f)),
      };
    });
  },
};

async function runWeb() {
  const webCtx = await esbuild.context({
    entryPoints: [
      'src/web/extension.ts',
      'src/web/test/suite/extensionTests.ts',
    ],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outdir: 'dist/web',
    external: ['vscode'],
    logLevel: 'silent',
    // Node.js global to browser globalThis
    define: {
      global: 'globalThis',
    },
    tsconfig: './tsconfig.web.json',
    plugins: [
      polyfill.NodeGlobalsPolyfillPlugin({
        process: true,
        buffer: true,
      }),
      testBundlePlugin,
      esbuildProblemMatcherPlugin /* add to the end of plugins array */,
    ],
  });
  if (watch) {
    await webCtx.watch();
  } else {
    await webCtx.rebuild().then((res) => webCtx.dispose());
  }
}

async function runDesktop() {
  const desktopCtx = await esbuild.context({
    entryPoints: [
      'src/desktop/extension.ts',
      'src/desktop/test/extension.test.ts',
    ],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    // platform: 'browser',
    outdir: 'dist/desktop',
    external: ['vscode'],
    logLevel: 'silent',
    // Node.js global to browser globalThis
    // define: {
    // 	global: 'globalThis',
    // },
    tsconfig: './tsconfig.node.json',
    plugins: [esbuildProblemMatcherPlugin],
  });
  if (watch) {
    await desktopCtx.watch();
  } else {
    await desktopCtx.rebuild().then((res) => desktopCtx.dispose());
  }
}

async function main() {
  if (!web && !desktop) {
    await Promise.all([runWeb(), runDesktop()]);
    return;
  }

  if (web) {
    await runWeb();
    return;
  }

  if (desktop) {
    await runDesktop();
    return;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
