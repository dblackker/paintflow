export function RouteLoading() {
  return (
    <main
      role="status"
      aria-label="Loading page"
      className="mx-auto min-h-[70vh] max-w-3xl space-y-5 px-4 py-8"
    >
      <span className="sr-only">Loading page</span>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-8 w-1/2 rounded bg-[var(--pf-surface-muted)]" />
        <div className="h-12 rounded bg-[var(--pf-surface-muted)]" />
        <div className="h-48 rounded bg-[var(--pf-surface-muted)]" />
        <div className="h-24 rounded bg-[var(--pf-surface-muted)]" />
      </div>
    </main>
  );
}
