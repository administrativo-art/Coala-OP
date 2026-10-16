import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertFirestoreEmulatorSafety } from './firestore-emulator-safety.mjs';

// Standalone API tests are not an RSC bundler. Keep React's normal runtime while
// resolving only the server-only boundary marker to its official empty entry.
// This hook is test-only and refuses to initialize outside the demo emulator.
export function enableServerOnlyTestImports(projectId) {
  assertFirestoreEmulatorSafety({ projectId });
  const require = createRequire(import.meta.url);
  const emptyEntry = new URL('./empty.js', pathToFileURL(require.resolve('server-only'))).href;
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === 'server-only' ? emptyEntry : specifier, context);
    },
  });
}
