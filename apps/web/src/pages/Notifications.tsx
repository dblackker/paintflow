import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { UpsellCard } from '@/components/UpsellCard';
import { apiJson } from '@/lib/api';

const readAuditKey = 'paintflow.readAuditNotifications';

interface NotificationCustomer {
  id?: string;
  name: string;
  phone?: string;
}

interface NotificationItem {
  id: string;
  source: 'notification' | 'message' | 'audit';
  sourceId?: string;
  type?: string;
  title: string;
  body: string;
  createdAt?: string;
  read: boolean;
  priority?: string;
  href?: string;
  customer?: NotificationCustomer | null;
}

interface NotificationsResponse {
  data?: NotificationItem[];
  meta?: {
    unreadMessages?: number;
    unreadHighPriority?: number;
  };
}

interface PushKeyResponse {
  data?: {
    publicKey?: string;
  };
}

function readAuditIds() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(readAuditKey) || '[]'));
  } catch {
    return new Set<string>();
  }
}

function saveReadAuditIds(ids: Set<string>) {
  localStorage.setItem(readAuditKey, JSON.stringify(Array.from(ids).slice(-500)));
}

function hydrateReadState(items: NotificationItem[]) {
  const auditRead = readAuditIds();
  return items.map((item) => item.source === 'audit' && auditRead.has(item.id) ? { ...item, read: true } : item);
}

function timeLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function showToast(message: string, type?: 'success' | 'error' | 'info') {
  window.showToast?.(message, type);
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const keyPayload = await apiJson<PushKeyResponse>('/v1/push/vapid-public-key');
  const publicKey = keyPayload.data?.publicKey;
  if (!publicKey) return false;

  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await apiJson('/v1/push/subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(subscription.toJSON()),
  });
  return true;
}

export function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [meta, setMeta] = useState<NotificationsResponse['meta']>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [isEnablingAlerts, setIsEnablingAlerts] = useState(false);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);
  const highPriorityCount = useMemo(
    () => notifications.filter((item) => !item.read && item.priority === 'high').length,
    [notifications],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      setIsLoading(true);
      setError('');
      try {
        const payload = await apiJson<NotificationsResponse>('/v1/notifications');
        if (cancelled) return;
        setNotifications(hydrateReadState(payload.data || []));
        setMeta(payload.meta || {});
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load notifications');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  async function markAllRead() {
    setIsMarkingAll(true);
    try {
      await apiJson('/v1/notifications/mark-read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ allMessages: true, allNotifications: true }),
      });
      const auditRead = readAuditIds();
      notifications.filter((item) => item.source === 'audit').forEach((item) => auditRead.add(item.id));
      saveReadAuditIds(auditRead);
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      window.dispatchEvent(new CustomEvent('paintflow:notifications-read'));
      showToast('Notifications marked read');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to mark notifications read', 'error');
    } finally {
      setIsMarkingAll(false);
    }
  }

  async function enableBrowserNotifications() {
    setIsEnablingAlerts(true);
    try {
      if (!('Notification' in window)) {
        showToast('This browser does not support notifications', 'error');
        return;
      }
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        localStorage.setItem('paintflow.browserNotifications', 'disabled');
        showToast('Browser alerts not enabled', 'error');
        return;
      }
      const subscribed = await subscribeToPush();
      localStorage.setItem('paintflow.browserNotifications', subscribed ? 'enabled' : 'disabled');
      showToast(
        subscribed ? 'Browser alerts enabled' : 'Push is not configured yet',
        subscribed ? 'success' : 'error',
      );
    } catch (err) {
      localStorage.setItem('paintflow.browserNotifications', 'disabled');
      showToast(err instanceof Error ? err.message : 'Failed to enable browser alerts', 'error');
    } finally {
      setIsEnablingAlerts(false);
    }
  }

  async function markItemRead(item: NotificationItem) {
    setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
    window.dispatchEvent(new CustomEvent('paintflow:notifications-read', { detail: { items: [item] } }));

    if (item.source === 'audit') {
      const auditRead = readAuditIds();
      auditRead.add(item.id);
      saveReadAuditIds(auditRead);
      return;
    }

    const body = item.source === 'message'
      ? { messageIds: [item.sourceId] }
      : { notificationIds: [item.sourceId || item.id] };

    await apiJson('/v1/notifications/mark-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  async function handleNotificationClick(event: MouseEvent<HTMLAnchorElement>, item: NotificationItem) {
    const href = item.href || '/notifications';
    if (!item.read) {
      event.preventDefault();
      await markItemRead(item);
      navigate(href);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-1 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">
          New messages, accepted estimates, and important customer activity.
        </p>
        <Button type="button" size="sm" onClick={markAllRead} disabled={!unreadCount} isLoading={isMarkingAll}>
          Mark read
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Unread</p>
          <p className="pf-metric mt-1">{unreadCount}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Priority</p>
          <p className="pf-metric mt-1">{highPriorityCount || meta?.unreadHighPriority || 0}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Messages</p>
          <p className="pf-metric mt-1">{meta?.unreadMessages || 0}</p>
        </Card>
      </div>

      <UpsellCard
        eyebrow="Field alerts"
        title="Get notified before work slips through the cracks"
        body="Turn on browser alerts for new customer messages, accepted estimates, and time-sensitive production updates while PaintFlow is open."
        ctaText="Enable alerts"
        icon="bell"
        onCta={enableBrowserNotifications}
        isLoading={isEnablingAlerts}
      />

      <Card padding="none" className="overflow-hidden">
        {isLoading && (
          <div className="space-y-0 divide-y">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex gap-3 p-4">
                <div className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-gray-200" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="p-8 text-center">
            <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
            <p className="pf-copy mt-2 text-red-700">{error}</p>
            <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !error && !notifications.length && (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <Icon name="message" className="h-5 w-5" />
            </div>
            <p className="pf-row-title mt-3">No notifications yet.</p>
            <p className="pf-copy mt-1">Customer messages and proposal activity will show up here.</p>
          </div>
        )}

        {!isLoading && !error && notifications.length > 0 && (
          <div className="divide-y">
            {notifications.map((item) => (
              <a
                key={item.id}
                href={item.href || '/notifications'}
                className={`block p-4 transition-colors hover:bg-gray-50 ${item.read ? 'bg-white' : 'bg-blue-50/70'}`}
                onClick={(event) => handleNotificationClick(event, item)}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      item.read ? 'bg-gray-300' : item.priority === 'high' ? 'bg-blue-600' : 'bg-green-600'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="pf-row-title truncate">{item.title}</p>
                        <p className="pf-copy mt-1 line-clamp-2">{item.body}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!item.read && <Badge variant={item.priority === 'high' ? 'info' : 'success'}>New</Badge>}
                        <p className="pf-meta whitespace-nowrap">{timeLabel(item.createdAt)}</p>
                      </div>
                    </div>
                    {item.customer && <p className="pf-meta mt-2">{item.customer.name || 'Customer'}</p>}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
