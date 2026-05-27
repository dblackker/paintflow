import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';

function errorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return 'We could not find that PaintFlow page.';
    return error.statusText || 'This page could not be loaded.';
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong while loading this page.';
}

export function ErrorPage({ notFound = false }: { notFound?: boolean }) {
  const error = useRouteError();
  const message = notFound ? 'We could not find that PaintFlow page.' : errorMessage(error);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-10">
      <Card padding="lg" className="w-full text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
          <Icon name="warning" className="h-6 w-6" />
        </div>
        <h1 className="pf-page-title mt-4">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
        <p className="pf-copy mt-2">{message}</p>
        <p className="pf-meta mt-2">If this keeps happening, refresh the page or return to the dashboard.</p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Button as="a" href="/dashboard">Go home</Button>
          <Button type="button" variant="secondary" onClick={() => window.location.reload()}>Refresh</Button>
        </div>
        <Link to="/activity" className="btn-text btn-sm mt-3 inline-flex">View activity</Link>
      </Card>
    </main>
  );
}
