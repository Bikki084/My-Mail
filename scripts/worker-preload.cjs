/**
 * The email worker runs via `tsx` outside the Next.js bundler. App libs use
 * `import "server-only"` for route protection; register a no-op module so
 * standalone worker startup does not require resolving that package first.
 */
const Module = require("node:module");

if (!Module._load.__mymailServerOnlyPatched) {
  const originalLoad = Module._load;
  Module._load = function mymailPatchedLoad(request, parent, isMain) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  Module._load.__mymailServerOnlyPatched = true;
}
