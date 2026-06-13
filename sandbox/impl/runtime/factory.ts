import type { SandboxSpec, SandboxOptions, ISandbox } from "./types.js";
import { Sandbox } from "./sandbox.js";

let _specPromise: Promise<SandboxSpec> | null = null;

/**
 * Creates a new sandbox instance. Loads spec files once and caches at module scope.
 * @param opts - Sandbox options
 * @returns A new Sandbox instance
 */
export async function createSandbox(opts: SandboxOptions = {}): Promise<ISandbox> {
  if (!_specPromise) {
    _specPromise = Promise.all([
      import("../loader.js").then(m => m.loadHerdrSpec()),
      import("../loader.js").then(m => m.loadPicodeSpec()),
      import("../loader.js").then(m => m.loadDockerSpec()),
      import("../loader.js").then(m => m.loadSystemSpec()),
      import("../loader.js").then(m => m.loadLimitsSpec()),
    ]).then(([herdr, picode, docker, system, limits]) =>
      ({ herdr, picode, docker, system, limits } as SandboxSpec)
    );
  }
  const spec = await _specPromise;
  return new Sandbox(spec, opts);
}
