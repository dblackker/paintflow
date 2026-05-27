import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@/components/Icon';

const links = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/pipeline', label: 'Pipeline', icon: 'kanban' },
  { href: '/leads', label: 'Leads', icon: 'users' },
  { href: '/calendar', label: 'Schedule', icon: 'calendar' },
  { href: '/more', label: 'More', icon: 'more-horizontal' },
];

const moreRoutes = [
  '/estimates',
  '/jobs',
  '/time',
  '/sms',
  '/invoices',
  '/reports',
  '/activity',
  '/settings',
  '/notifications',
];

function isActive(pathname: string, href: string) {
  if (href === '/more') return moreRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white px-2 py-2 lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {links.map((link) => {
          const active = isActive(location.pathname, link.href);
          const to = link.href === '/more' ? '/settings' : link.href;
          return (
            <Link
              key={link.href}
              to={to}
              className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-center text-xs font-medium ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
              aria-label={link.label === 'More' ? 'Open CRM settings and more tools' : link.label}
            >
              <Icon name={link.icon} className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
