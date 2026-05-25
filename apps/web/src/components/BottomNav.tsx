import { Link, useLocation } from 'react-router-dom';

const links = [
  { href: '/dashboard', label: 'Home' },
  { href: '/leads', label: 'Leads' },
  { href: '/estimates', label: 'Estimates' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/time', label: 'Time' },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white px-2 py-2 lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {links.map((link) => {
          const active = location.pathname === link.href || location.pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              to={link.href}
              className={`rounded-lg px-2 py-2 text-center text-xs font-medium ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
