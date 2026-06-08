import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@/components/Icon';

const links = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/pipeline', label: 'Pipeline', icon: 'kanban' },
  { href: '/leads', label: 'Leads', icon: 'users' },
  { href: '/calendar', label: 'Schedule', icon: 'calendar' },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {links.map((link) => {
          const active = isActive(location.pathname, link.href);
          return (
            <Link
              key={link.href}
              to={link.href}
              className={`flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-1.5 text-center text-xs font-medium ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
              aria-label={link.label}
            >
              <Icon name={link.icon} className="h-5 w-5" />
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
