import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { notificationPresentation } from '../src/utils/notification-presentation.js';
const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['src/components/InspectorNotifications.jsx'], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const render = props => renderToStaticMarkup(createElement(module.exports.default, { notifications: [], ...props }));
test('PPE outcome selects green, red or amber independent of entry access', () => {
  assert.equal(notificationPresentation({ result: 'compliant' }).tone, 'compliant');
  assert.equal(notificationPresentation({ result: 'violation', authorization_status: 'authorized' }).tone, 'violation');
  assert.equal(notificationPresentation({ alert_type: 'non_compliant' }).tone, 'violation');
  for (const record of [{}, { alert_type: 'manual_review' }, { result: 'violation', resolution_status: 'FALSE_DETECTION' }]) assert.equal(notificationPresentation(record).tone, 'manual-review');
});
test('verified review takes precedence over the original scan outcome', () => {
  assert.equal(notificationPresentation({ result: 'violation', review_status: 'reviewed', inspector_decision: 'compliant' }).tone, 'compliant');
  assert.equal(notificationPresentation({ result: 'compliant', review_status: 'reviewed', inspector_decision: 'non_compliant' }).tone, 'violation');
  assert.equal(notificationPresentation({ result: 'violation', review_status: 'reviewed', inspector_decision: 'unable_to_verify' }).tone, 'manual-review');
});
test('side notifications render accessible outcome labels, dismiss and incident actions', () => {
  const html = renderToStaticMarkup(createElement(module.exports.InspectorNotificationToasts, { notifications: [
    { id: 1, result: 'compliant', message: '<script>unsafe()</script>' },
    { id: 2, alert_type: 'non_compliant', detection_id: 7 },
    { id: 3, alert_type: 'manual_review' },
  ] }));
  for (const tone of ['compliant', 'violation', 'manual-review']) assert.match(html, new RegExp(`ins-notification-tone-${tone}`));
  assert.match(html, /aria-live="polite"/); assert.match(html, /Dismiss Compliant notification/);
  assert.match(html, />View incident →<\/button>/); assert.doesNotMatch(html, /<script>/);
});
test('popups dismiss only after their own fade completes, or by explicit close', () => {
  const dismissed = [], opened = [];
  const notification = { id: 'live-7', detection_id: 7, alert_type: 'manual_review' };
  const tree = module.exports.InspectorNotificationToasts({ notifications: [notification],
    onDismiss: id => dismissed.push(id), onOpenIncident: item => opened.push(item) });
  const section = tree.props.children[0];
  const target = {};
  section.props.onAnimationEnd({ target, currentTarget: target, animationName: 'ins-notification-enter' });
  section.props.onAnimationEnd({ target: {}, currentTarget: target, animationName: 'ins-notification-exit' });
  assert.deepEqual(dismissed, []);
  section.props.onAnimationEnd({ target, currentTarget: target, animationName: 'ins-notification-exit' });
  assert.deepEqual(dismissed, ['live-7']);
  section.props.children[2].props.onClick();
  assert.deepEqual(dismissed, ['live-7', 'live-7']);
  section.props.children[1].props.children[3].props.onClick();
  assert.deepEqual(opened, [notification]);
});
test('unread notifications expose individual and bulk read actions separately from viewing the incident', () => {
  const html = render({ notifications: [{ id: 1, detection_id: 7, title: '<script>unsafe()</script>', is_read: false }] });
  assert.match(html, />Mark all as read<\/button>/); assert.match(html, />Mark as read<\/button>/);
  assert.match(html, />View incident →<\/button>/);
  let depth = 0;
  for (const tag of html.match(/<\/?button\b[^>]*>/g)) {
    depth += tag.startsWith('</') ? -1 : 1;
    assert.ok(depth >= 0 && depth <= 1, 'Buttons must not be nested');
  }
  assert.equal(depth, 0);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('bulk read remains available for older unseen notifications and saving disables mutation buttons', () => {
  assert.match(render({}), /disabled="">Mark all as read/);
  const read = render({ notifications: [{ id: 1, is_read: true }] });
  assert.doesNotMatch(read, /disabled="">Mark all as read/);
  assert.doesNotMatch(read, />Mark as read</);
  const html = render({ notifications: [{ id: 1, is_read: false }], saving: true, error: 'Could not save.' });
  assert.match(html, /disabled="">Mark as read/); assert.match(html, /role="alert"/); assert.match(html, /aria-busy="true"/);
});
