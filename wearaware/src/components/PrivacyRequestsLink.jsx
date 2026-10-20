import { ShieldCheck } from 'lucide-react';

export default function PrivacyRequestsLink({ className }) {
  return <a className={className} href="/privacy/requests" style={{ textDecoration: 'none' }}>
    <ShieldCheck size={18} aria-hidden="true" />Privacy requests
  </a>;
}
