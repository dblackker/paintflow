import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { API_URL, PaintFlowApiError } from '@/lib/api';

interface ServiceErrorStateProps {
  error: unknown;
  title?: string;
  pageName?: string;
  onRetry?: () => void;
  compact?: boolean;
}

function errorCopy(error: unknown, pageName?: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  const isApiError = error instanceof PaintFlowApiError;
  const networkFailure = isApiError
    ? error.serviceUnavailable
    : /failed to fetch|network|unreachable|load failed/i.test(message);

  if (networkFailure) {
    return {
      title: 'Data service unavailable',
      body: `The ${pageName || 'page'} loaded, but PaintFlow could not reach the API service that supplies this data. This is usually temporary; retry in a moment.`,
      detail: message || 'Network request failed',
      tone: 'danger' as const,
    };
  }

  return {
    title: 'Could not load this data',
    body: `PaintFlow could not finish loading ${pageName ? pageName.toLowerCase() : 'this page'}. Retry once; if it continues, capture the details below.`,
    detail: message || 'Request failed',
    tone: 'warning' as const,
  };
}

export function ServiceErrorState({ error, title, pageName, onRetry, compact = false }: ServiceErrorStateProps) {
  const copy = errorCopy(error, pageName);
  const border = copy.tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50';
  const icon = copy.tone === 'danger' ? 'text-red-700 bg-red-100' : 'text-yellow-800 bg-yellow-100';

  return (
    <Card className={`${border} ${compact ? 'p-4' : 'p-5 sm:p-6'}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${icon}`}>
            <Icon name="warning" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="pf-section-title text-gray-950">{title || copy.title}</p>
            <p className="pf-copy mt-1 text-gray-800">{copy.body}</p>
            <div className="mt-3 rounded-lg border border-black/10 bg-white/70 p-3">
              <p className="pf-meta text-gray-700">Service: {API_URL}</p>
              <p className="pf-meta mt-1 text-gray-700">Details: {copy.detail}</p>
            </div>
          </div>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry} className="shrink-0">
            <Icon name="refresh" className="pf-icon" />
            Retry
          </Button>
        )}
      </div>
    </Card>
  );
}
