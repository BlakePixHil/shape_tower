// The few Node APIs the tests use, so the project needs no @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(code: number): never };
