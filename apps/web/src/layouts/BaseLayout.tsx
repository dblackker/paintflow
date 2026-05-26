import { Outlet, useLocation, Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { BottomNav } from '@/components/BottomNav';
import { Toast } from '@/components/Toast';
import { AuthBridge } from '@/components/AuthBridge';
import { API_URL, apiJson } from '@/lib/api';

const navSections = [
  {
    label: 'Sales',
    links: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/leads', label: 'Leads' },
      { href: '/pipeline', label: 'Pipeline' },
      { href: '/estimates', label: 'Estimates' },
    ],
  },
  {
    label: 'Operations',
    links: [
      { href: '/jobs', label: 'Jobs' },
      { href: '/calendar', label: 'Calendar' },
      { href: '/time', label: 'Time Tracking' },
    ],
  },
  {
    label: 'Admin',
    links: [
      { href: '/reports', label: 'Reports' },
      { href: '/activity', label: 'Activity' },
      { href: '/team', label: 'Team' },
      { href: '/email-templates', label: 'Email Templates' },
      { href: '/settings', label: 'Settings' },
    ],
  },
];

interface NotificationPreview {
  id: string;
  source?: string;
  sourceId?: string;
  title: string;
  message?: string;
  href?: string;
  read?: boolean;
  createdAt?: string;
}

function routeTitle(pathname: string) {
  if (pathname === '/') return 'PaintFlow';
  if (pathname.startsWith('/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/leads/')) return 'Customer';
  if (pathname.startsWith('/leads')) return 'Leads';
  if (pathname.startsWith('/pipeline')) return 'Pipeline';
  if (pathname.startsWith('/estimates/production')) return 'Production Estimate';
  if (pathname.startsWith('/estimates/new')) return 'Quick Estimate';
  if (pathname.startsWith('/estimates/')) return 'Estimate';
  if (pathname.startsWith('/estimates')) return 'Estimates';
  if (pathname.startsWith('/jobs/')) return 'Job Detail';
  if (pathname.startsWith('/jobs')) return 'Jobs';
  if (pathname.startsWith('/calendar')) return 'Calendar';
  if (pathname.startsWith('/time')) return 'Time Tracking';
  if (pathname.startsWith('/reports') || pathname.startsWith('/reporting')) return 'Reports';
  if (pathname.startsWith('/activity')) return 'Activity';
  if (pathname.startsWith('/team')) return 'Team';
  if (pathname.startsWith('/email-templates')) return 'Email Templates';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/notifications')) return 'Notifications';
  if (pathname.startsWith('/production-rates')) return 'Production Rates';
  if (pathname.startsWith('/materials')) return 'Paint Products';
  if (pathname.startsWith('/billing')) return 'Billing';
  if (pathname.startsWith('/payments/stripe')) return 'Stripe';
  if (pathname.startsWith('/dev/design-system')) return 'Design System';
  return 'PaintFlow';
}

function notificationTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

export function BaseLayout() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPreview[]>([]);
  const title = useMemo(() => routeTitle(location.pathname), [location.pathname]);
  const unreadCount = notifications.filter((item) => !item.read).length;

  useEffect(() => {
    // Handle localhost redirect
    if (window.location.hostname === '127.0.0.1' && 
        Number(window.location.port || 0) >= 4321 && 
        Number(window.location.port || 0) <= 4399) {
      const url = new URL(window.location.href);
      url.hostname = 'localhost';
      window.location.replace(url.toString());
    }
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('pf-nav-drawer-open', isMobileMenuOpen);
    return () => document.body.classList.remove('pf-nav-drawer-open');
  }, [isMobileMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    async function loadNotifications() {
      try {
        const notificationResponse = await fetch(`${API_URL}/v1/notifications`, { credentials: 'include' });
        if (!notificationResponse.ok) {
          if (!cancelled) setNotifications([]);
          return;
        }
        const response = await notificationResponse.json() as { data?: NotificationPreview[] };
        if (!cancelled) setNotifications(response.data || []);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    }
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function logout() {
    try {
      await apiJson('/v1/auth/logout', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
    } catch {
      // Local session cleanup still happens through the API redirect path if the server is unavailable.
    } finally {
      window.location.href = '/login';
    }
  }

  async function markNotificationRead(item: NotificationPreview) {
    setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
    if (item.source === 'notification') {
      try {
        await apiJson('/v1/notifications/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ notificationIds: [item.sourceId || item.id] }),
        });
      } catch {
        window.showToast?.('Failed to mark notification read', 'error');
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AuthBridge />

      <nav className="pf-app-nav sticky top-0 z-50 border-b shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <button
              type="button"
              className="pf-mobile-menu-button"
              aria-label="Open navigation"
              aria-controls="app-nav-drawer"
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <p className="truncate text-lg font-semibold text-gray-950 sm:text-xl">{title}</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  className="btn-icon pf-notification-button relative"
                  aria-label="Open notifications"
                  aria-expanded={notificationsOpen}
                  onClick={() => setNotificationsOpen((open) => !open)}
                >
                  <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 0 1-6 0m6 0H9" />
                  </svg>
                  {unreadCount > 0 && <span className="pf-notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                </button>
                {notificationsOpen && (
                  <div className="pf-notifications-menu absolute right-0 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-lg border bg-white shadow-lg">
                    <div className="flex items-center justify-between gap-3 border-b p-3">
                      <div>
                        <p className="font-semibold text-gray-950">Notifications</p>
                        <p className="text-xs text-gray-500">Messages and customer events</p>
                      </div>
                      <Link to="/notifications" className="text-sm font-medium text-blue-700">View all</Link>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length ? notifications.slice(0, 6).map((item) => (
                        <Link
                          key={item.id}
                          to={item.href || '/notifications'}
                          className={`block border-b p-3 last:border-b-0 hover:bg-gray-50 ${item.read ? '' : 'bg-blue-50'}`}
                          onClick={() => markNotificationRead(item)}
                        >
                          <span className="block text-sm font-semibold text-gray-950">{item.title}</span>
                          {item.message && <span className="mt-1 block text-sm text-gray-600">{item.message}</span>}
                          <span className="mt-1 block text-xs text-gray-500">{notificationTime(item.createdAt)}</span>
                        </Link>
                      )) : (
                        <div className="p-4 text-sm text-gray-500">No notifications yet.</div>
                      )}
                    </div>
                    <div className="border-t p-2">
                      <Link to="/notifications" className="btn-secondary btn-sm w-full justify-center">Notification settings</Link>
                    </div>
                  </div>
                )}
              </div>
              <Link to="/dashboard" className="pf-app-brand-link" aria-label="PaintFlow dashboard">
                <span className="pf-brand-mark">P</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {isMobileMenuOpen && (
        <div className="relative z-[150]">
          <div className="pf-mobile-nav-scrim is-open" onClick={() => setIsMobileMenuOpen(false)} />
          <div id="app-nav-drawer" className="pf-mobile-nav is-open border-r">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-4">
              <Link to="/dashboard" className="flex items-center gap-3" onClick={() => setIsMobileMenuOpen(false)}>
                <span className="pf-brand-mark">P</span>
                <span className="text-lg font-semibold text-gray-950">PaintFlow</span>
              </Link>
              <button
                type="button"
                className="btn-icon"
                aria-label="Close navigation"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4 px-4 py-3">
              <Link
                to="/dashboard"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`block py-2 text-sm ${location.pathname.startsWith('/dashboard') ? 'bg-blue-50 text-blue-700' : ''}`}
              >
                Dashboard
              </Link>
              {navSections.map((section) => (
                <section key={section.label} className="pf-mobile-nav-section">
                  <p>{section.label}</p>
                  <div className="grid grid-cols-1 gap-1">
                    {section.links.map((item) => {
                      const isActive = location.pathname === item.href ||
                        (item.href !== '/' && location.pathname.startsWith(`${item.href}/`));
                      return (
                        <Link
                          key={item.label}
                          to={item.href}
                          onClick={() => setIsMobileMenuOpen(false)}
                          className={`block py-2 text-sm ${isActive ? 'bg-blue-50 text-blue-700' : ''}`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
              <button type="button" className="pf-mobile-logout-button" onClick={logout}>Log out</button>
            </div>
          </div>
        </div>
      )}

      <main className="py-6 pb-24 lg:pb-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>

      <BottomNav />
      <Toast />
    </div>
  );
}
