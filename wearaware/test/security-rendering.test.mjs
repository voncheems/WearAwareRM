import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { escapeHtml, safePhoto, printDocument } from '../src/utils/print.js';

test('worker and review text is escaped in React text nodes and printable HTML', () => {
  const payload = '<img src=x onerror="stealToken()"> & \' quoted';
  const rendered = renderToStaticMarkup(React.createElement('span', null, payload));
  assert.equal(rendered.includes('<img'), false);
  assert.ok(rendered.includes('&lt;img'));
  assert.equal(escapeHtml(payload), '&lt;img src=x onerror=&quot;stealToken()&quot;&gt; &amp; &#39; quoted');
  const attribute = `<td title="${escapeHtml('\" onmouseover=\"stealToken()')}">Safe</td>`;
  assert.equal(attribute.includes('title="" onmouseover='), false);
  assert.ok(attribute.includes('&quot;'));
});

test('print evidence permits only raster base64 data and rejects executable or remote URLs', () => {
  assert.equal(safePhoto('data:image/jpeg;base64,VEVTVA=='), 'data:image/jpeg;base64,VEVTVA==');
  for (const value of ['javascript:stealToken()', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://external.example.test/photo.jpg', 'data:image/png;base64,AA==" onload="stealToken()', null, {}]) {
    assert.equal(safePhoto(value), '');
  }
});

test('print window severs opener and applies restrictive CSP before record text', () => {
  const previous = globalThis.window;
  let output = '', printed = false, closed = false;
  const popup = { opener: {}, document: { write(html) { output = html; }, close() {} }, print() { printed = true; }, close() { closed = true; } };
  try {
    globalThis.window = { open: () => popup };
    printDocument(`<html><head></head><body>${escapeHtml('<script>stealToken()</script>')}</body></html>`, true);
    assert.equal(popup.opener, null);
    assert.ok(output.indexOf('Content-Security-Policy') < output.indexOf('<body>'));
    assert.ok(output.includes('default-src &#39;none&#39;'));
    assert.ok(output.includes('form-action &#39;none&#39;'));
    assert.equal(output.includes('<script>'), false);
    popup.onload(); popup.onafterprint();
    assert.equal(printed, true); assert.equal(closed, true);
  } finally { globalThis.window = previous; }
});
