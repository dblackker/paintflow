import { createBrowserRouter } from "react-router-dom";
import { BaseLayout } from "@/layouts/BaseLayout";
import { ErrorPage } from "@/pages/ErrorPage";

// Keep matching and error boundaries synchronous; download only the selected
// screen. Customer documents remain outside the authenticated application shell.
export const router = createBrowserRouter([
  {
    path: "/",
    lazy: async () => ({
      Component: (await import("@/pages/landing/Landing")).Landing,
    }),
    errorElement: <ErrorPage />,
  },
  {
    path: "/estimates/:id",
    lazy: async () => ({
      Component: (await import("@/pages/estimates/EstimateDetail"))
        .EstimateDetail,
    }),
    errorElement: <ErrorPage />,
  },
  {
    path: "/estimates/:id/success",
    lazy: async () => ({
      Component: (await import("@/pages/estimates/EstimateDetail"))
        .EstimateDetail,
    }),
    errorElement: <ErrorPage />,
  },
  {
    path: "/portal/:token",
    lazy: async () => ({ Component: (await import("@/pages/Portal")).Portal }),
    errorElement: <ErrorPage />,
  },
  {
    path: "/privacy",
    lazy: async () => ({
      Component: (await import("@/pages/legal/LegalPages")).PrivacyPolicy,
    }),
    errorElement: <ErrorPage />,
  },
  {
    path: "/terms",
    lazy: async () => ({
      Component: (await import("@/pages/legal/LegalPages")).TermsOfService,
    }),
    errorElement: <ErrorPage />,
  },
  {
    element: <BaseLayout />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/dashboard",
        lazy: async () => ({
          Component: (await import("@/pages/Dashboard")).Dashboard,
        }),
      },
      {
        path: "/estimates",
        lazy: async () => ({
          Component: (await import("@/pages/estimates/EstimatesList"))
            .EstimatesList,
        }),
      },
      {
        path: "/estimates/new",
        lazy: async () => ({
          Component: (await import("@/pages/estimates/EstimateNew"))
            .EstimateNew,
        }),
      },
      {
        path: "/estimates/production",
        lazy: async () => ({
          Component: (await import("@/pages/estimates/EstimateProduction"))
            .EstimateProduction,
        }),
      },
      {
        path: "/estimates/:id/details",
        lazy: async () => ({
          Component: (await import("@/pages/estimates/EstimateDetails"))
            .EstimateDetails,
        }),
      },
      {
        path: "/estimates/:id/photos",
        lazy: async () => ({
          Component: (await import("@/pages/estimates/EstimatePhotos"))
            .EstimatePhotos,
        }),
      },
      {
        path: "/jobs",
        lazy: async () => ({
          Component: (await import("@/pages/jobs/JobsList")).JobsList,
        }),
      },
      {
        path: "/jobs/:id",
        lazy: async () => ({
          Component: (await import("@/pages/jobs/JobDetail")).JobDetail,
        }),
      },
      {
        path: "/leads",
        lazy: async () => ({
          Component: (await import("@/pages/Leads")).Leads,
        }),
      },
      {
        path: "/leads/:id",
        lazy: async () => ({
          Component: (await import("@/pages/leads/LeadDetail")).LeadDetail,
        }),
      },
      {
        path: "/calendar",
        lazy: async () => ({
          Component: (await import("@/pages/Calendar")).Calendar,
        }),
      },
      {
        path: "/billing",
        lazy: async () => ({
          Component: (await import("@/pages/Billing")).Billing,
        }),
      },
      {
        path: "/reporting",
        lazy: async () => ({
          Component: (await import("@/pages/Reporting")).Reporting,
        }),
      },
      {
        path: "/reporting/lead-sources",
        lazy: async () => ({
          Component: (await import("@/pages/reporting/LeadSources"))
            .LeadSources,
        }),
      },
      {
        path: "/sms",
        lazy: async () => ({ Component: (await import("@/pages/SMS")).SMS }),
      },
      {
        path: "/help",
        lazy: async () => ({ Component: (await import("@/pages/Help")).Help }),
      },
      {
        path: "/activity",
        lazy: async () => ({
          Component: (await import("@/pages/Activity")).Activity,
        }),
      },
      {
        path: "/invoices",
        lazy: async () => ({
          Component: (await import("@/pages/Invoices")).Invoices,
        }),
      },
      {
        path: "/invoices/:id",
        lazy: async () => ({
          Component: (await import("@/pages/invoices/InvoiceDetail"))
            .InvoiceDetail,
        }),
      },
      {
        path: "/materials",
        lazy: async () => ({
          Component: (await import("@/pages/Materials")).Materials,
        }),
      },
      {
        path: "/notifications",
        lazy: async () => ({
          Component: (await import("@/pages/Notifications")).Notifications,
        }),
      },
      {
        path: "/onboarding",
        lazy: async () => ({
          Component: (await import("@/pages/Onboarding")).Onboarding,
        }),
      },
      {
        path: "/payroll",
        lazy: async () => ({
          Component: (await import("@/pages/Payroll")).Payroll,
        }),
      },
      {
        path: "/pipeline",
        lazy: async () => ({
          Component: (await import("@/pages/Pipeline")).Pipeline,
        }),
      },
      {
        path: "/production-rates",
        lazy: async () => ({
          Component: (await import("@/pages/ProductionRates")).ProductionRates,
        }),
      },
      {
        path: "/reports",
        lazy: async () => ({
          Component: (await import("@/pages/Reports")).Reports,
        }),
      },
      {
        path: "/reviews",
        lazy: async () => ({
          Component: (await import("@/pages/Reviews")).Reviews,
        }),
      },
      {
        path: "/roles",
        lazy: async () => ({
          Component: (await import("@/pages/Roles")).Roles,
        }),
      },
      {
        path: "/settings",
        lazy: async () => ({
          Component: (await import("@/pages/Settings")).Settings,
        }),
      },
      {
        path: "/supplier-catalog",
        lazy: async () => ({
          Component: (await import("@/pages/SupplierCatalog")).SupplierCatalog,
        }),
      },
      {
        path: "/team",
        lazy: async () => ({ Component: (await import("@/pages/Team")).Team }),
      },
      {
        path: "/templates",
        lazy: async () => ({
          Component: (await import("@/pages/Templates")).Templates,
        }),
      },
      {
        path: "/time",
        lazy: async () => ({ Component: (await import("@/pages/Time")).Time }),
      },
      {
        path: "/review/:id",
        lazy: async () => ({
          Component: (await import("@/pages/Review")).Review,
        }),
      },
      {
        path: "/email-templates",
        lazy: async () => ({
          Component: (await import("@/pages/EmailTemplates")).EmailTemplates,
        }),
      },
      {
        path: "/payments/stripe",
        lazy: async () => ({
          Component: (await import("@/pages/payments/StripePayments"))
            .StripePayments,
        }),
      },
      {
        path: "/dev/design-system",
        lazy: async () => ({
          Component: (await import("@/pages/dev/DesignSystem")).DesignSystem,
        }),
      },
      {
        path: "/developers/lead-intake",
        lazy: async () => ({
          Component: (await import("@/pages/developers/LeadIntakeDocs"))
            .LeadIntakeDocs,
        }),
      },
    ],
  },
  {
    path: "/login",
    lazy: async () => ({
      Component: (await import("@/pages/auth/Login")).Login,
    }),
    errorElement: <ErrorPage />,
  },
  {
    path: "/signup",
    lazy: async () => ({
      Component: (await import("@/pages/auth/Signup")).Signup,
    }),
    errorElement: <ErrorPage />,
  },
  { path: "*", element: <ErrorPage notFound /> },
]);
