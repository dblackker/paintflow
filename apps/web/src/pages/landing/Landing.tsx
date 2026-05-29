import { Link } from 'react-router-dom';

export function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            Crewmodo
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            The complete CRM for trade contractors. Manage leads, estimates, jobs, crews, and billing in one place.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Link
              to="/signup"
              className="rounded-md bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Get started
            </Link>
            <Link to="/login" className="text-sm font-semibold leading-6 text-gray-900">
              Log in <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        
        <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold">Quick Estimates</h3>
            <p className="mt-2 text-sm text-gray-600">
              Create professional estimates in minutes with production rates and photo takeoff.
            </p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold">Lead Management</h3>
            <p className="mt-2 text-sm text-gray-600">
              Track leads from first contact to closed job with pipeline management.
            </p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold">Team Coordination</h3>
            <p className="mt-2 text-sm text-gray-600">
              Schedule crews, track time, and manage jobs from anywhere.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
