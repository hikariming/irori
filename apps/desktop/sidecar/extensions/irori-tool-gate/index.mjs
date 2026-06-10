// Loadable entry point pi discovers via this package's `pi.extensions`. The
// behaviour lives in the sidecar source so it stays unit-testable; here we only
// re-export the guarded default (no-op in the parent, enforce in children).
export { default } from "../../src/extensions/irori-tool-gate.mjs";
