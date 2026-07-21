type RuntimeBindings = {
  DB: D1Database;
  [key: string]: unknown;
};

declare global {
  // Set by the Worker entry point before the vinext handler reads bindings.
  var __PRIXRADAR_RUNTIME_ENV__: Record<string, unknown> | undefined;
}

export const runtimeEnv = new Proxy({} as RuntimeBindings, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    const workerValue = globalThis.__PRIXRADAR_RUNTIME_ENV__?.[property];
    if (workerValue !== undefined) return workerValue;
    return typeof process !== "undefined" ? process.env[property] : undefined;
  },
});

export function setRuntimeEnv(bindings: object) {
  globalThis.__PRIXRADAR_RUNTIME_ENV__ = bindings as Record<string, unknown>;
}
