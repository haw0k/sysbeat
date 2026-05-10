declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement<BindParameters extends unknown[] = unknown[], Result = unknown> {
    database: Database;
    source: string;
    reader: boolean;
    readonly: boolean;
    busy: boolean;
    run(...params: BindParameters): RunResult;
    get(...params: BindParameters): Result | undefined;
    all(...params: BindParameters): Result[];
    iterate(...params: BindParameters): IterableIterator<Result>;
    pluck(toggleState?: boolean): this;
    expand(toggleState?: boolean): this;
    raw(toggleState?: boolean): this;
    bind(...params: BindParameters): this;
    columns(): Array<{ name: string; column: string | null; table: string | null; database: string | null; type: string | null }>;
    safeIntegers(toggleState?: boolean): this;
  }

  interface Database {
    memory: boolean;
    readonly: boolean;
    name: string;
    open: boolean;
    inTransaction: boolean;
    prepare<BindParameters extends unknown[], Result>(source: string): Statement<BindParameters, Result>;
    exec(source: string): this;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    checkpoint(databaseName?: string): this;
    function(name: string, options: { varargs: true; deterministic?: boolean; directOnly?: boolean }, fn: (...params: unknown[]) => unknown): this;
    function(name: string, options: { deterministic?: boolean; directOnly?: boolean }, fn: (...params: unknown[]) => unknown): this;
    function(name: string, fn: (...params: unknown[]) => unknown): this;
    aggregate(name: string, options: { start?: unknown; step: (...params: unknown[]) => unknown; result?: () => unknown }): this;
    loadExtension(path: string): this;
    close(): void;
    defaultSafeIntegers(toggleState?: boolean): this;
    backup(destinationFile: string): Promise<{ totalPages: number; remainingPages: number }>;
    table(name: string, options: { columns: string[]; parameters?: string[]; rows: () => IterableIterator<unknown[]> | unknown[]; directOnly?: boolean }): this;
  }

  class Database {
    constructor(filename?: string | Buffer | Uint8Array, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number; verbose?: (message: unknown) => void; nativeBinding?: string });
  }

  export default Database;
}
