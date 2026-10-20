export const PRIVACY_REQUEST_STATUSES = [
  ['PENDING', 'Pending'], ['UNDER_REVIEW', 'Under Review'], ['RESOLVED', 'Resolved'], ['REJECTED', 'Rejected'],
];
export function privacyReviewOptions(current) {
  if (current === 'PENDING') return ['UNDER_REVIEW', 'REJECTED'];
  if (current === 'UNDER_REVIEW') return ['UNDER_REVIEW', 'RESOLVED', 'REJECTED'];
  return [];
}
