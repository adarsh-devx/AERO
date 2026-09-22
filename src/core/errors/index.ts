/**
 * Thrown where an implementation is intentionally unavailable.
 *
 * Used by architecture-boundary stubs (providers, playback engine) to
 * make "not implemented yet" an explicit, loud failure instead of a
 * fake success or a silent no-op.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet — see docs/PRD.md and docs/PROVIDERS.md for the pending decisions.`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Thrown when media/OS permission has been requested and denied.
 * Callers must surface this distinctly from "no results" — a denied
 * permission must never look like an empty library.
 */
export class PermissionDeniedError extends Error {
  constructor(message = 'Required media permission was denied.') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Thrown when a required native module is not available (e.g. custom
 * native code is missing from the current runtime/build).
 */
export class NativeModuleUnavailableError extends Error {
  constructor(moduleName: string) {
    super(`Native module "${moduleName}" is not available in this runtime.`);
    this.name = 'NativeModuleUnavailableError';
  }
}

