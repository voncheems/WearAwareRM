// Escape all record-derived values before putting them in a printable HTML template.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function safePhoto(value) {
  return typeof value === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}
export function printDocument(html, closeAfterPrint = false) {
  const win = window.open('', '_blank');
  if (!win) { window.alert('Allow pop-ups to print this report.'); return; }
  win.opener = null;
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">';
  win.document.write(html.replace('<head>', '<head>' + policy));
  win.onload = () => win.print();
  if (closeAfterPrint) win.onafterprint = () => win.close();
  win.document.close();
}
