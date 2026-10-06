export interface DashboardOverview {
  date: string;
  timeZone: string;
  totalCustomers: number;
  newLeads: number;
  awaitingApproval: number;
  overdueTasks: number;
  dueToday: number;
  todayJobCount: number;
  todayJobs: Array<{
    id: string;
    name: string;
    status: string;
    customerName: string;
    streetAddress: string | null;
    city: string | null;
    state: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    customerName: string | null;
    dueAt: string;
    overdue: boolean;
    href: string;
  }>;
}

export interface DashboardCollections {
  invoiceCount: number;
  outstanding: string;
  overdueCount: number;
  overdue: string;
  reviewCount: number;
}
