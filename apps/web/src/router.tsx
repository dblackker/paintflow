import { createBrowserRouter } from 'react-router-dom';
import { BaseLayout } from '@/layouts/BaseLayout';
import { Dashboard } from '@/pages/Dashboard';
import { EstimatesList } from '@/pages/estimates/EstimatesList';
import { EstimateNew } from '@/pages/estimates/EstimateNew';
import { EstimateDetail } from '@/pages/estimates/EstimateDetail';
import { EstimateDetails } from '@/pages/estimates/EstimateDetails';
import { EstimatePhotos } from '@/pages/estimates/EstimatePhotos';
import { EstimateProduction } from '@/pages/estimates/EstimateProduction';
import { JobsList } from '@/pages/jobs/JobsList';
import { JobDetail } from '@/pages/jobs/JobDetail';
import { Leads } from '@/pages/Leads';
import { LeadDetail } from '@/pages/leads/LeadDetail';
import { Calendar } from '@/pages/Calendar';
import { Billing } from '@/pages/Billing';
import { Reporting } from '@/pages/Reporting';
import { LeadSources } from '@/pages/reporting/LeadSources';
import { SMS } from '@/pages/SMS';
import { Portal } from '@/pages/Portal';
import { Help } from '@/pages/Help';
import { Login } from '@/pages/auth/Login';
import { Signup } from '@/pages/auth/Signup';
import { Onboarding } from '@/pages/Onboarding';
import { Activity } from '@/pages/Activity';
import { Invoices } from '@/pages/Invoices';
import { Materials } from '@/pages/Materials';
import { Notifications } from '@/pages/Notifications';
import { Payroll } from '@/pages/Payroll';
import { Pipeline } from '@/pages/Pipeline';
import { ProductionRates } from '@/pages/ProductionRates';
import { Reports } from '@/pages/Reports';
import { Reviews } from '@/pages/Reviews';
import { Roles } from '@/pages/Roles';
import { Settings } from '@/pages/Settings';
import { SupplierCatalog } from '@/pages/SupplierCatalog';
import { Team } from '@/pages/Team';
import { Templates } from '@/pages/Templates';
import { Time } from '@/pages/Time';
import { Review } from '@/pages/Review';
import { EmailTemplates } from '@/pages/EmailTemplates';
import { StripePayments } from '@/pages/payments/StripePayments';
import { DesignSystem } from '@/pages/dev/DesignSystem';
import { Landing } from '@/pages/landing/Landing';
import { ErrorPage } from '@/pages/ErrorPage';

export const router = createBrowserRouter([
  {
    path: '/estimates/:id',
    element: <EstimateDetail />,
    errorElement: <ErrorPage />,
  },
  {
    path: '/estimates/:id/success',
    element: <EstimateDetail />,
    errorElement: <ErrorPage />,
  },
  {
    element: <BaseLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/estimates', element: <EstimatesList /> },
      { path: '/estimates/new', element: <EstimateNew /> },
      { path: '/estimates/production', element: <EstimateProduction /> },
      { path: '/estimates/:id/details', element: <EstimateDetails /> },
      { path: '/estimates/:id/photos', element: <EstimatePhotos /> },
      { path: '/jobs', element: <JobsList /> },
      { path: '/jobs/:id', element: <JobDetail /> },
      { path: '/leads', element: <Leads /> },
      { path: '/leads/:id', element: <LeadDetail /> },
      { path: '/calendar', element: <Calendar /> },
      { path: '/billing', element: <Billing /> },
      { path: '/reporting', element: <Reporting /> },
      { path: '/reporting/lead-sources', element: <LeadSources /> },
      { path: '/sms', element: <SMS /> },
      { path: '/portal/:token', element: <Portal /> },
      { path: '/help', element: <Help /> },
      { path: '/activity', element: <Activity /> },
      { path: '/invoices', element: <Invoices /> },
      { path: '/materials', element: <Materials /> },
      { path: '/notifications', element: <Notifications /> },
      { path: '/onboarding', element: <Onboarding /> },
      { path: '/payroll', element: <Payroll /> },
      { path: '/pipeline', element: <Pipeline /> },
      { path: '/production-rates', element: <ProductionRates /> },
      { path: '/reports', element: <Reports /> },
      { path: '/reviews', element: <Reviews /> },
      { path: '/roles', element: <Roles /> },
      { path: '/settings', element: <Settings /> },
      { path: '/supplier-catalog', element: <SupplierCatalog /> },
      { path: '/team', element: <Team /> },
      { path: '/templates', element: <Templates /> },
      { path: '/time', element: <Time /> },
      { path: '/review/:id', element: <Review /> },
      { path: '/email-templates', element: <EmailTemplates /> },
      { path: '/payments/stripe', element: <StripePayments /> },
      { path: '/dev/design-system', element: <DesignSystem /> },
    ],
  },
  {
    path: '/login',
    element: <Login />,
    errorElement: <ErrorPage />,
  },
  {
    path: '/signup',
    element: <Signup />,
    errorElement: <ErrorPage />,
  },
  {
    path: '*',
    element: <ErrorPage notFound />,
  },
]);
