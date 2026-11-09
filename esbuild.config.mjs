import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';
const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map((m) => 'node:' + m)],
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  minify: false,
  treeShaking: true,
  logLevel: 'info',
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); } else await ctx.watch();
