// Draft organizational details. Replace only with controller-approved information.
// These are public notice fields, never credentials or operational secrets.
export const privacyNotice = Object.freeze({
  version: 'draft-2026-10-19',
  controllerName: null,
  privacyOfficer: null,
  privacyContact: null,
});

export function isPrivacyNoticePath(pathname) {
  return pathname === '/privacy' || pathname === '/privacy/';
}

export function isPrivacyRequestsPath(pathname) {
  return pathname === '/privacy/requests' || pathname === '/privacy/requests/';
}
