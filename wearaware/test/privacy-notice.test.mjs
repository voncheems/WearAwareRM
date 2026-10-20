import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { isPrivacyNoticePath, isPrivacyRequestsPath, privacyNotice } from '../src/config/privacy-notice.js';
import { PRIVACY_REQUEST_STATUSES, privacyReviewOptions } from '../src/config/privacy-requests.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function component(path) {
  const bundle = await build({ absWorkingDir: root, entryPoints: [path], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"DEV":true,"PROD":false}' } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports.default;
}

test('public privacy path selection is exact and does not intercept other application routes', () => {
  assert.equal(isPrivacyNoticePath('/privacy'), true);
  assert.equal(isPrivacyNoticePath('/privacy/'), true);
  for (const path of ['/', '/admin', '/scanner', '/login', '/privacy/admin', '/api/auth/login']) {
    assert.equal(isPrivacyNoticePath(path), false);
  }
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /isPrivacyNoticePath\(window.location.pathname\)\s*\?\s*<PrivacyNoticePage\s*\/>/);
  assert.match(main, /isPrivacyRequestsPath\(window.location.pathname\)\s*\?\s*<PrivacyRequestsPage\s*\/>\s*:\s*<App\s*\/>/);
});

test('privacy notice renders without authentication, browser storage or network access', async () => {
  const Page = await component('src/components/PrivacyNoticePage.jsx');
  const html = renderToStaticMarkup(createElement(Page));
  assert.match(html, /<h1>Privacy notice<\/h1>/);
  assert.match(html, /Draft — organizational approval pending/);
  assert.match(html, /This page does not submit a request/);
  assert.match(html, /No approved record-retention schedule/);
  assert.match(html, /AI can miss PPE/);
  assert.match(html, /privacy.gov.ph\/data-subject-rights/);
  assert.doesNotMatch(html, /<form|type="checkbox"|mailto:/);
  for (const id of ['organization', 'data', 'decisions', 'access', 'retention', 'rights']) {
    assert.ok(html.includes(`href="#privacy-${id}"`));
    assert.ok(html.includes(`id="privacy-${id}"`));
  }
});

test('organizational fields remain explicitly pending and acknowledgment is not treated as consent', () => {
  assert.equal(privacyNotice.controllerName, null);
  assert.equal(privacyNotice.privacyOfficer, null);
  assert.equal(privacyNotice.privacyContact, null);
  const source = readFileSync(new URL('../src/components/PrivacyNoticePage.jsx', import.meta.url), 'utf8');
  assert.match(source, /Opening this page is not consent or recorded acknowledgment/);
  assert.match(source, /not a dedicated privacy-request tracking system/);
});

test('public navigation, landing footer and login expose the notice without a login gate', async () => {
  const Nav = await component('src/components/MarketingNav.jsx');
  const html = renderToStaticMarkup(createElement(Nav, { currentPage: 'landing', setCurrentPage: () => {} }));
  assert.match(html, /href="\/privacy"[^>]*>Privacy notice<\/a>/);
  const landing = readFileSync(new URL('../src/components/LandingPage.jsx', import.meta.url), 'utf8');
  assert.match(landing, /<a href="\/privacy">Privacy notice<\/a>/);
  const login = readFileSync(new URL('../src/components/LoginPage.jsx', import.meta.url), 'utf8');
  assert.match(login, /href="\/privacy" target="_blank" rel="noopener noreferrer"/);
});

test('privacy request route is exact and is discoverable from the public notice', async () => {
  assert.equal(isPrivacyRequestsPath('/privacy/requests'), true);
  assert.equal(isPrivacyRequestsPath('/privacy/requests/'), true);
  for (const path of ['/', '/privacy', '/privacy/requests/admin', '/admin', '/scanner']) assert.equal(isPrivacyRequestsPath(path), false);
  const Page = await component('src/components/PrivacyNoticePage.jsx');
  const html = renderToStaticMarkup(createElement(Page));
  assert.match(html, /href="\/privacy\/requests"/);
  assert.match(html, /No self-service export, correction, blocking, or deletion/);
});

test('privacy request page initially withholds forms and records while account authorization is pending', async () => {
  const Page = await component('src/components/PrivacyRequestsPage.jsx');
  const html = renderToStaticMarkup(createElement(Page));
  assert.match(html, /<h1>Privacy requests<\/h1>/);
  assert.match(html, /Checking your personal account/);
  assert.doesNotMatch(html, /<form|Administrator review|Bearer /);
  assert.match(html, /do not automatically export, change, block or delete/);
});

test('privacy request presentation offers only four simple states and no review action on closed requests', () => {
  assert.deepEqual(PRIVACY_REQUEST_STATUSES.map(([, title]) => title), ['Pending', 'Under Review', 'Resolved', 'Rejected']);
  assert.deepEqual(privacyReviewOptions('PENDING'), ['UNDER_REVIEW', 'REJECTED']);
  assert.deepEqual(privacyReviewOptions('UNDER_REVIEW'), ['UNDER_REVIEW', 'RESOLVED', 'REJECTED']);
  assert.deepEqual(privacyReviewOptions('RESOLVED'), []);
  assert.deepEqual(privacyReviewOptions('REJECTED'), []);
});

test('personal dashboards expose a direct privacy request link with existing navigation styling', async () => {
  const Link = await component('src/components/PrivacyRequestsLink.jsx');
  const html = renderToStaticMarkup(createElement(Link, { className: 'ins-nav-item' }));
  assert.match(html, /class="ins-nav-item"/);
  assert.match(html, /href="\/privacy\/requests"/);
  assert.match(html, /Privacy requests/);
  for (const name of ['AdminDashboard', 'InspectorDashboard', 'UserDashboard']) {
    const source = readFileSync(new URL(`../src/components/${name}.jsx`, import.meta.url), 'utf8');
    assert.match(source, /<PrivacyRequestsLink className="(?:ad|ins)-nav-item"/);
  }
});
