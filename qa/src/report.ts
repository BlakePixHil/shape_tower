// Writes each suite's results to qa/reports/ as JSON (everything) and Markdown (the summary a person reads).
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, type SimUnderTest } from './adapters/index';

export const REPORT_DIR = resolve(REPO_ROOT, 'qa/reports');

function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export interface ReportMeta {
  suite: string;
  sim: Pick<SimUnderTest, 'kind' | 'engine' | 'source'>;
  full: boolean;
}

export interface Report extends ReportMeta {
  commit: string;
  at: string;
  verdict: 'pass' | 'fail' | 'info';
  /** One line per check, already worded for a person. */
  lines: string[];
  data: unknown;
}

export function writeReport(meta: ReportMeta, verdict: Report['verdict'], lines: string[], data: unknown): Report {
  const report: Report = { ...meta, commit: commit(), at: new Date().toISOString(), verdict, lines, data };
  mkdirSync(REPORT_DIR, { recursive: true });
  const base = resolve(REPORT_DIR, `${meta.suite}-${meta.sim.kind}-${meta.sim.engine}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
  const md = [
    `# ${meta.suite}: ${verdict.toUpperCase()}`,
    '',
    `Sim: ${meta.sim.kind} (${meta.sim.engine}, ${meta.sim.source}) · commit ${report.commit} · ${meta.full ? 'full run' : 'fast set'} · ${report.at}`,
    '',
    ...lines.map((l) => `- ${l}`),
    '',
  ].join('\n');
  writeFileSync(`${base}.md`, md);
  return report;
}

export const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
export const fmt = (v: number | null | undefined, digits = 4) => (v === null || v === undefined ? 'n/a' : v.toFixed(digits));
