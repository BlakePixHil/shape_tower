// The few Node APIs the tests use, so the project needs no @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { argv: string[]; exit(code: number): never };
