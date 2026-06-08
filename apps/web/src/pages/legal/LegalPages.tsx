import { Link } from 'react-router-dom';

type Section = {
  title: string;
  body?: string[];
  bullets?: string[];
};

const updatedAt = 'June 8, 2026';

const privacySections: Section[] = [
  {
    title: '1. What this policy covers',
    body: [
      'This Privacy Policy explains how Crewmodo collects, uses, shares, and protects information when people visit our websites, create an account, use the Crewmodo platform, communicate with us, or interact with customer-facing proposal, invoice, payment, and client portal links.',
      'Crewmodo provides software to contractors and service businesses. When a contractor uses Crewmodo to manage their customers, jobs, invoices, photos, messages, timecards, or supplier invoices, the contractor is generally responsible for deciding what data is entered and how it is used. Crewmodo processes that customer and job data to provide the service.',
    ],
  },
  {
    title: '2. Information we collect',
    bullets: [
      'Account and business information, such as name, email address, phone number, company name, billing details, service areas, setup preferences, and subscription plan.',
      'Contractor operations data, such as leads, customer contacts, jobsite addresses, estimates, proposals, contracts, change orders, invoices, payments, refunds, job costs, schedules, photos, notes, tasks, messages, review links, production rates, paint products, and supplier invoice records.',
      'Field workforce data, such as crew member names, roles, email addresses, pay and burden-rate settings, time entries, punch-in and punch-out times, GPS coordinates, approval status, and timecard review notes.',
      'Client portal data, such as proposal views, signatures, selected options, invoice views, payment actions, and communications associated with a contractor customer.',
      'Files and content uploaded to the service, such as logos, job photos, supplier receipts, invoices, statements, and related extracted text or structured data.',
      'Technical and usage data, such as IP address, browser type, device information, operating system, pages viewed, feature usage, performance data, error logs, request metadata, and security events.',
      'Integration data from services you connect, such as Stripe, Google Calendar, email providers, storage providers, accounting systems, or other tools. The exact data depends on the integration and permissions you authorize.',
    ],
  },
  {
    title: '3. How we use information',
    bullets: [
      'Provide, operate, secure, and improve Crewmodo.',
      'Create and manage accounts, workspaces, subscriptions, invoices, payments, and support requests.',
      'Deliver contractor workflows, including estimates, proposals, signatures, change orders, job scheduling, time tracking, job costing, messaging, notifications, supplier invoice processing, and reporting.',
      'Send service emails, including magic links, trial and billing notices, proposal updates, invoice reminders, receipts, change order notices, and operational alerts.',
      'Analyze usage, diagnose errors, monitor system health, prevent abuse, and enforce rate limits.',
      'Support connected integrations at your direction, including calendar sync, payment processing, email delivery, file storage, and future accounting connectors.',
      'Use AI-assisted processing where enabled, such as supplier invoice OCR, job-cost extraction, or future automation features. AI processing is limited to the requested workflow and related service improvement, security, and audit needs.',
      'Comply with legal obligations, protect rights and safety, investigate abuse, and enforce our terms.',
    ],
  },
  {
    title: '4. Google user data',
    body: [
      'If you connect Google Calendar, Crewmodo uses Google user data only to provide and maintain the calendar sync you request. Crewmodo does not sell Google user data, does not use it for advertising, and does not use it to train generalized AI models. You can disconnect Google Calendar from the app or by revoking access in your Google account.',
    ],
  },
  {
    title: '5. How we share information',
    bullets: [
      'With users in the same contractor workspace according to their role and permissions.',
      'With contractor customers when a contractor sends customer-facing proposals, invoices, receipts, change orders, client portal links, messages, or other shared documents.',
      'With service providers that help us run Crewmodo, such as cloud hosting, database, storage, email delivery, payment processing, analytics, security, AI/OCR processing, and customer support providers.',
      'With integration partners when you connect or use an integration, such as payment, calendar, email, or accounting providers.',
      'With authorities, courts, regulators, or other parties when we believe disclosure is required by law or needed to protect rights, safety, security, or prevent fraud.',
      'In connection with a merger, acquisition, financing, reorganization, bankruptcy, or sale of business assets, subject to appropriate protections.',
    ],
  },
  {
    title: '6. Payments',
    body: [
      'Crewmodo uses third-party payment processors for subscription billing and contractor payment workflows. We do not store full payment card numbers on Crewmodo servers. Payment processors may collect and process payment information under their own terms and privacy policies.',
    ],
  },
  {
    title: '7. Cookies and analytics',
    body: [
      'Crewmodo may use cookies, local storage, and similar technologies to keep users signed in, remember preferences, improve the app, measure usage, diagnose errors, and protect against abuse. You can control cookies through your browser settings, but some product functionality may not work without required cookies or local storage.',
    ],
  },
  {
    title: '8. Data security',
    body: [
      'We use reasonable technical, organizational, and administrative safeguards designed to protect information, including access controls, encryption in transit, cloud security controls, secrets management, logging, and tenant-isolation practices. No system is perfectly secure, so contractors should use strong access practices and limit sensitive uploads to business-relevant information.',
    ],
  },
  {
    title: '9. Data retention',
    body: [
      'We retain information for as long as needed to provide the service, comply with legal and accounting obligations, resolve disputes, maintain audit trails, prevent fraud, and enforce agreements. Contractors can request deletion of their workspace data, subject to legal, security, backup, billing, and audit-retention limits.',
    ],
  },
  {
    title: '10. Your choices and rights',
    bullets: [
      'You can access and update many account and business settings from within Crewmodo.',
      'You can unsubscribe from marketing emails, but service and transactional emails may still be sent.',
      'You can disconnect integrations where supported.',
      'Depending on your location, you may have rights to access, correct, delete, restrict, object to, or receive a copy of certain personal information.',
      'If your information is stored by a contractor using Crewmodo, contact that contractor first. Crewmodo may need to work through the contractor because they control the customer relationship and related records.',
    ],
  },
  {
    title: '11. Children',
    body: [
      'Crewmodo is intended for business use and is not directed to children under 13. We do not knowingly collect personal information from children under 13.',
    ],
  },
  {
    title: '12. Changes',
    body: [
      'We may update this policy from time to time. If changes are material, we will provide notice through the app, email, or another reasonable method. The updated policy will be effective when posted unless a later date is stated.',
    ],
  },
  {
    title: '13. Contact',
    body: [
      'Questions about this Privacy Policy can be sent to support@crewmodo.com.',
    ],
  },
];

const termsSections: Section[] = [
  {
    title: '1. Agreement to these terms',
    body: [
      'These Terms of Service govern access to and use of Crewmodo websites, applications, APIs, client portals, and related services. By creating an account, using Crewmodo, or accessing the service on behalf of a company, you agree to these terms and represent that you have authority to bind that company.',
    ],
  },
  {
    title: '2. The service',
    body: [
      'Crewmodo provides contractor CRM and operations software, including workflows for leads, estimates, proposals, e-signatures, change orders, invoices, payments, scheduling, job costing, time tracking, supplier invoice processing, communication history, reporting, and connected integrations. Features may vary by plan, environment, region, and configuration.',
    ],
  },
  {
    title: '3. Accounts and administrators',
    bullets: [
      'You are responsible for accurate account information, authorized users, role assignments, workspace settings, and all activity under your workspace.',
      'You must protect login links, sessions, connected accounts, API keys, webhook secrets, and administrator access.',
      'If you invite employees, contractors, crew members, or other users, you are responsible for ensuring they are authorized and use Crewmodo appropriately.',
      'Crewmodo may suspend access if we reasonably believe an account is compromised, used unlawfully, creates security risk, or violates these terms.',
    ],
  },
  {
    title: '4. Customer data and contractor responsibilities',
    body: [
      'You own and control the business data you enter into Crewmodo, including customer records, job information, estimates, contracts, invoices, photos, timecards, messages, and uploaded documents. You grant Crewmodo permission to process that data to provide, secure, support, and improve the service.',
      'You are responsible for the accuracy, legality, and appropriateness of your customer communications, proposals, contracts, payment schedules, taxes, payroll records, job costing, and invoices. Crewmodo provides software tools and does not provide legal, tax, accounting, payroll, construction compliance, or insurance advice.',
    ],
  },
  {
    title: '5. Legal documents, e-signatures, and payments',
    bullets: [
      'Crewmodo may help generate or store proposals, terms, change orders, invoices, receipts, signatures, and payment records. You are responsible for reviewing and approving your legal language and disclosures before using them with customers.',
      'E-signature and payment workflows depend on correct workspace configuration, customer information, payment processor setup, and applicable law.',
      'Payment processors, card networks, banks, and connected financial providers may impose separate terms, fees, reserves, disputes, refunds, and compliance obligations.',
      'Manual payment records, refunds, credits, and adjustments are ledger records entered by users and should be reconciled with your books and payment processor records.',
    ],
  },
  {
    title: '6. Subscriptions, trials, billing, and cancellation',
    bullets: [
      'Paid plans, usage limits, and feature access are described at signup, in billing settings, or in an order form.',
      'If a free trial is offered, a payment method may be required and the selected plan may renew automatically after the trial unless canceled before the trial ends.',
      'Subscriptions are billed in advance unless otherwise stated. Taxes, payment processor fees, usage charges, and add-ons may apply.',
      'You can cancel according to the in-app billing flow or by contacting support. Cancellation generally stops future renewal but does not automatically refund past charges unless required by law or expressly agreed.',
      "Crewmodo may change pricing or plan packaging with notice. Existing customers may be kept on legacy pricing at Crewmodo's discretion or under a written agreement.",
    ],
  },
  {
    title: '7. Acceptable use',
    bullets: [
      'Do not use Crewmodo for unlawful, deceptive, abusive, harassing, discriminatory, or harmful activity.',
      'Do not upload malicious code, attempt unauthorized access, interfere with the service, bypass rate limits, scrape non-public data, or test security without permission.',
      'Do not use Crewmodo to send spam, unlawful marketing, or communications without required consent.',
      'Do not store sensitive personal information that is not needed for contractor operations, such as full government IDs, full payment card numbers, medical records, or unrelated personal data.',
      'Do not misrepresent your identity, authority, licenses, insurance, pricing, taxes, contract terms, or customer approvals.',
    ],
  },
  {
    title: '8. Integrations and third-party services',
    body: [
      'Crewmodo may connect with third-party services such as Stripe, Google, Resend, Cloudflare, OpenAI, accounting platforms, mapping tools, and other providers. These services are governed by their own terms and privacy policies. Crewmodo is not responsible for third-party services, outages, data handling, pricing, or changes. You can disconnect integrations where supported.',
    ],
  },
  {
    title: '9. APIs, webhooks, and automation',
    body: [
      'If you use Crewmodo APIs, webhooks, inbound email processing, or automation features, you are responsible for securing credentials, using stable idempotency keys where required, validating payloads, complying with rate limits, and ensuring any connected system has authority to send or receive the data involved.',
    ],
  },
  {
    title: '10. Availability and changes to the service',
    body: [
      'We work to keep Crewmodo reliable, but the service may be unavailable due to maintenance, updates, network issues, third-party outages, security events, or events outside our control. We may add, change, limit, or remove features over time. We will try to avoid materially reducing core paid functionality without reasonable notice.',
    ],
  },
  {
    title: '11. Intellectual property',
    body: [
      'Crewmodo and its software, design, workflows, documentation, logos, and related materials are owned by Crewmodo or its licensors. These terms grant you a limited, non-exclusive, non-transferable right to use Crewmodo for your business during an active subscription or authorized trial. You may not copy, modify, reverse engineer, resell, or create competing services from Crewmodo except as allowed by law or written permission.',
    ],
  },
  {
    title: '12. Confidentiality',
    body: [
      'Each party may receive non-public information from the other. The receiving party will use reasonable care to protect confidential information and use it only for purposes related to the service, unless disclosure is required by law or authorized by the disclosing party.',
    ],
  },
  {
    title: '13. Disclaimers',
    body: [
      'Crewmodo is provided "as is" and "as available" to the maximum extent permitted by law. We disclaim warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted operation, and error-free performance. Crewmodo does not guarantee legal compliance, tax accuracy, payroll compliance, job profitability, customer payment, or project outcomes.',
    ],
  },
  {
    title: '14. Limitation of liability',
    body: [
      "To the maximum extent permitted by law, Crewmodo will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, business interruption, or substitute services. Crewmodo's total liability for claims related to the service will not exceed the amounts paid by you to Crewmodo for the service in the 12 months before the event giving rise to the claim.",
    ],
  },
  {
    title: '15. Indemnity',
    body: [
      'You will defend and indemnify Crewmodo from claims, damages, liabilities, costs, and expenses arising from your customer data, your use of the service, your customer communications, your contracts or invoices, your connected integrations, your violation of law, or your breach of these terms.',
    ],
  },
  {
    title: '16. Termination',
    body: [
      'You may stop using Crewmodo or cancel your subscription at any time. We may suspend or terminate access if you violate these terms, fail to pay, create security risk, or use the service unlawfully. After termination, we may retain or delete data according to the Privacy Policy, legal obligations, backup practices, and reasonable business needs.',
    ],
  },
  {
    title: '17. Governing law and disputes',
    body: [
      'These terms are governed by the laws of the State of Washington, without regard to conflict-of-law rules. Before filing a claim, each party will try in good faith to resolve the dispute informally by contacting the other party. If a dispute cannot be resolved informally, it will be handled in a court of competent jurisdiction in Washington unless applicable law requires a different forum.',
    ],
  },
  {
    title: '18. Changes',
    body: [
      'We may update these terms from time to time. If changes are material, we will provide reasonable notice through the app, email, or another method. Continued use after the effective date means you accept the updated terms.',
    ],
  },
  {
    title: '19. Contact',
    body: [
      'Questions about these Terms of Service can be sent to support@crewmodo.com.',
    ],
  },
];

function BrandHeader() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-lg font-bold text-blue-700">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--pf-primary)] text-sm font-bold text-white">C</span>
          Crewmodo
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn-text btn-sm">Sign in</Link>
          <Link to="/signup" className="btn-primary btn-sm">Start trial</Link>
        </div>
      </div>
    </header>
  );
}

function LegalSection({ section }: { section: Section }) {
  return (
    <section className="border-t border-gray-200 pt-6">
      <h2 className="text-xl font-semibold tracking-normal text-gray-950">{section.title}</h2>
      {section.body?.map((paragraph) => (
        <p key={paragraph} className="mt-3 text-base leading-7 text-gray-700">{paragraph}</p>
      ))}
      {section.bullets && (
        <ul className="mt-3 grid gap-2 pl-5 text-base leading-7 text-gray-700">
          {section.bullets.map((item) => (
            <li key={item} className="list-disc">{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LegalPageShell({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: Section[];
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <BrandHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <p className="pf-meta">Last updated {updatedAt}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950 sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-gray-700">{intro}</p>
          <div className="mt-8 grid gap-6">
            {sections.map((section) => (
              <LegalSection key={section.title} section={section} />
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      intro="This policy describes Crewmodo's privacy practices for our websites, app, contractor workspaces, customer portals, integrations, and support interactions."
      sections={privacySections}
    />
  );
}

export function TermsOfService() {
  return (
    <LegalPageShell
      title="Terms of Service"
      intro="These terms explain the rules for using Crewmodo as contractor CRM and field operations software."
      sections={termsSections}
    />
  );
}
