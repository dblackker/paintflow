import { Outlet, useLocation, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BottomNav } from '@/components/BottomNav';
import { Toast } from '@/components/Toast';
import { AuthBridge } from '@/components/AuthBridge';

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

export function BaseLayout() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <AuthBridge />
      
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r border-gray-200 bg-white px-6 pb-4">
          <div className="flex h-16 shrink-0 items-center">
            <Link to="/dashboard" className="text-xl font-bold text-blue-600">
              PaintFlow
            </Link>
          </div>
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7">
              {navSections.map((section) => (
                <li key={section.label}>
                  <div className="text-xs font-semibold leading-6 text-gray-400">
                    {section.label}
                  </div>
                  <ul role="list" className="-mx-2 mt-2 space-y-1">
                    {section.links.map((item) => {
                      const isActive = location.pathname === item.href || 
                                     (item.href !== '/' && location.pathname.startsWith(item.href));
                      return (
                        <li key={item.label}>
                          <Link
                            to={item.href}
                            className={`group flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 ${
                              isActive
                                ? 'bg-gray-50 text-blue-600'
                                : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'
                            }`}
                          >
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </aside>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="relative z-50 lg:hidden">
          <div className="fixed inset-0 bg-gray-900/80" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="fixed inset-0 flex">
            <div className="relative mr-16 flex w-full max-w-xs flex-1">
              <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                <button
                  type="button"
                  className="-m-2.5 p-2.5"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span className="sr-only">Close sidebar</span>
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4">
                <div className="flex h-16 shrink-0 items-center">
                  <Link to="/dashboard" className="text-xl font-bold text-blue-600">
                    PaintFlow
                  </Link>
                </div>
                <nav className="flex flex-1 flex-col">
                  <ul role="list" className="flex flex-1 flex-col gap-y-7">
                    {navSections.map((section) => (
                      <li key={section.label}>
                        <div className="text-xs font-semibold leading-6 text-gray-400">
                          {section.label}
                        </div>
                        <ul role="list" className="-mx-2 mt-2 space-y-1">
                          {section.links.map((item) => (
                            <li key={item.label}>
                              <Link
                                to={item.href}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="group flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 text-gray-700 hover:bg-gray-50 hover:text-blue-600"
                              >
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Mobile header */}
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:hidden">
          <button
            type="button"
            className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <span className="sr-only">Open sidebar</span>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex-1 text-sm font-semibold leading-6 text-gray-900">
            PaintFlow
          </div>
        </div>

        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>

        <BottomNav />
      </div>

      <Toast />
    </div>
  );
}
