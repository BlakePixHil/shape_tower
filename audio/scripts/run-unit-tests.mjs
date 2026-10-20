// Bundles test/unit/*.test.ts with esbuild and runs them with node's built-in test runner.
import { build } from 'esbuild';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'test', 'unit');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort();
const out = mkdtempSync(join(tmpdir(), 'shape-tower-audio-unit-'));
try {
  await build({
    entryPoints: files.map((f) => join(dir, f)),
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
  const r = spawnSync(process.execPath, ['--test', ...files.map((f) => join(out, f.replace(/\.ts$/, '.mjs')))], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
