import { X, CheckCircle, AlertTriangle, ClipboardList } from 'lucide-react';
import { notificationPresentation } from '../utils/notification-presentation';

export function InspectorNotificationToasts({ notifications, onDismiss, onOpenIncident }) {
  return <div className="ins-notification-toasts" aria-live="polite" aria-relevant="additions">
    {notifications.map(notification => {
      const { tone, label } = notificationPresentation(notification);
      const Icon = tone === 'compliant' ? CheckCircle : tone === 'violation' ? AlertTriangle : ClipboardList;
      return <section key={notification.id} className={`ins-notification-toast ins-notification-tone-${tone}`} aria-label={label}
        onAnimationEnd={event => {
          if (event.target === event.currentTarget && event.animationName === 'ins-notification-exit') onDismiss(notification.id);
        }}>
        <Icon className="ins-toast-icon" size={20} aria-hidden="true" />
        <div className="ins-toast-content"><strong>{label}</strong><p>{notification.message || notification.title || 'A scan result is available.'}</p>
          {notification.station && <small>{notification.station}</small>}
          {notification.detection_id && <button type="button" onClick={() => onOpenIncident(notification)}>View incident →</button>}
        </div>
        <button type="button" className="ins-toast-dismiss" aria-label={`Dismiss ${label} notification`} onClick={() => onDismiss(notification.id)}><X size={17} /></button>
      </section>;
    })}
  </div>;
}

export default function InspectorNotifications({ notifications, error, saving, onRefresh, onClose, onMarkRead, onMarkAllRead, onOpenIncident }) {
  return (
    <div className="ins-notification-panel" role="dialog" aria-label="Inspector notifications" aria-busy={saving}>
      <div className="ins-notification-header">
        <strong>Notifications</strong>
        <div className="ins-notification-header-actions">
          <button type="button" disabled={saving || notifications.length === 0} onClick={onMarkAllRead}>Mark all as read</button>
          <button type="button" disabled={saving} onClick={onRefresh}>Refresh</button>
          <button type="button" aria-label="Close notifications" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      {error && <div className="ins-notification-error" role="alert">{error}</div>}
      {notifications.length === 0 ? <div className="ins-notification-empty">No notifications yet.</div> : (
        <div className="ins-notification-list">{notifications.map(notification => (
          <div key={notification.id} className={`ins-notification-item ins-notification-tone-${notificationPresentation(notification).tone} ${notification.is_read ? 'read' : 'unread'}`}>
            <span className="ins-notification-dot" />
            <div className="ins-notification-content">
              <small className="ins-notification-outcome">{notificationPresentation(notification).label}</small>
              <strong>{notification.title || 'Inspector notification'}{notification.risk_severity && <em className={`ins-risk-badge ins-risk-${String(notification.risk_severity).toLowerCase()}`}>{notification.risk_severity} risk</em>}</strong>
              <small>{notification.message || 'Open the violation history to review this incident.'}</small>
              <small>{notification.station || 'Checkpoint'} · {notification.worker_name || notification.worker_employee_id || 'Worker'} · {notification.created_at ? new Date(notification.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now'}</small>
              <div className="ins-notification-actions">
                {notification.detection_id && <button type="button" className="ins-notification-link" onClick={() => onOpenIncident(notification)}>View incident →</button>}
                {notification.is_read ? <small className="ins-notification-read-label">Read</small> : <button type="button" disabled={saving} onClick={() => onMarkRead(notification)}>Mark as read</button>}
              </div>
            </div>
          </div>
        ))}</div>
      )}
    </div>
  );
}
