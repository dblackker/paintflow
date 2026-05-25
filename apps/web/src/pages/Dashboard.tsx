import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';

interface DashboardStats {
  activeLeads: number;
  estimatesSent: number;
  jobsThisMonth: number;
}

interface Activity {
  id: string;
  title: string;
  status: string;
  clientName: string;
  leadId?: string;
  total?: number;
  occurredAt: string;
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    activeLeads: 0,
    estimatesSent: 0,
    jobsThisMonth: 0,
  });
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8787`;
      
      const [statsRes, activityRes] = await Promise.all([
        fetch(`${API_URL}/v1/dashboard/stats`, { credentials: 'include' }),
        fetch(`${API_URL}/v1/activities/feed?limit=5`, { credentials: 'include' }),
      ]);

      if (statsRes.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (statsRes.ok) {
        const { data } = await statsRes.json();
        setStats(data);
      }

      if (activityRes.ok) {
        const { data } = await activityRes.json();
        setRecentActivity(data || []);
      }
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="dashboard-shell mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-6xl">
      <div className="dashboard-hero flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-gray-600 mt-1">Run today's lead, estimate, and job workflow from one place.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Link to="/leads?new=1" className="btn-primary btn-sm justify-center">
            <Icon name="plus" /> Add lead
          </Link>
          <Link to="/estimates/production" className="btn-secondary btn-sm justify-center">
            <Icon name="file-text" /> Estimate
          </Link>
          <Link to="/jobs" className="btn-secondary btn-sm justify-center">
            <Icon name="briefcase" /> Jobs
          </Link>
          <Link to="/time" className="btn-secondary btn-sm justify-center">
            <Icon name="clock" /> Time
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <Link to="/leads" className="dashboard-metric-card p-5 sm:p-6 rounded-lg bg-white border border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
          <p className="text-sm text-gray-600">Active leads</p>
          <p className="text-3xl font-bold mt-2">{stats.activeLeads}</p>
          <p className="text-sm text-blue-700 mt-3">Open leads</p>
        </Link>
        <Link to="/estimates" className="dashboard-metric-card p-5 sm:p-6 rounded-lg bg-white border border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
          <p className="text-sm text-gray-600">Estimates sent</p>
          <p className="text-3xl font-bold mt-2">{stats.estimatesSent}</p>
          <p className="text-sm text-blue-700 mt-3">Review estimates</p>
        </Link>
        <Link to="/jobs" className="dashboard-metric-card p-5 sm:p-6 rounded-lg bg-white border border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
          <p className="text-sm text-gray-600">Jobs this month</p>
          <p className="text-3xl font-bold mt-2">{stats.jobsThisMonth}</p>
          <p className="text-sm text-blue-700 mt-3">Open schedule</p>
        </Link>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="rounded-lg bg-white border border-gray-200 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-lg font-semibold">Recent Activity</h3>
            <Link to="/activity" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="font-medium">No activity yet</p>
              <p className="text-sm text-gray-600 mt-1">Add a lead to start tracking calls, estimates, and jobs.</p>
              <Link to="/leads?new=1" className="btn-primary btn-sm mt-4">Add lead</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((activity) => (
                <Link
                  key={activity.id}
                  to={`/estimates/${activity.id}`}
                  className="block border border-gray-200 rounded-lg bg-white p-4 hover:bg-gray-50 hover:border-blue-300 transition-all"
                >
                  <p className="font-medium">{activity.title}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    {new Date(activity.occurredAt).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg bg-white border border-gray-200 p-5">
            <p className="font-semibold">Quick actions</p>
            <p className="text-sm text-gray-600 mt-0.5">Configure the shortcuts your team uses daily.</p>
            <div className="mt-4 grid gap-2">
              <Link to="/leads?new=1" className="btn-primary btn-sm justify-start">
                <Icon name="plus" /> Add lead
              </Link>
              <Link to="/estimates/production" className="btn-secondary btn-sm justify-start">
                <Icon name="file-text" /> Create estimate
              </Link>
              <Link to="/time" className="btn-secondary btn-sm justify-start">
                <Icon name="clock" /> Log time
              </Link>
              <Link to="/jobs" className="btn-secondary btn-sm justify-start">
                <Icon name="briefcase" /> Open jobs
              </Link>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
