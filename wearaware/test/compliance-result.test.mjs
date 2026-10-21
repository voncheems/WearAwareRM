import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const bundle = await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/components/ComplianceResult.jsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Component = module.exports.default;
for (const [name, decision, label] of [
  ['verified compliant false positive', 'compliant', 'Compliant'],
  ['verified missing PPE despite false detection', 'non_compliant', 'Violation'],
  ['unverified historical false detection', null, 'Inconclusive — PPE unverified'],
]) test(name + ' renders final status separately from the original scan', () => {
  const html = renderToStaticMarkup(createElement(Component, { record: {
    result: 'violation', ai_result: 'violation', resolution_status: 'FALSE_DETECTION',
    ...(decision ? { review_status: 'reviewed', inspector_decision: decision } : {}),
    worker_name: '<script>sensitive</script>', authorization_status: 'authorized',
  } }));
  assert.match(html, new RegExp('>' + label + '</span>'));
  assert.match(html, /Original scan: Violation/);
  assert.doesNotMatch(html, /sensitive|script|Authorized/);
});
