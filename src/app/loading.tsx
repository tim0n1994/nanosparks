/**
 * Route-level loading state. Keeps the page frame (nav height + content column)
 * so navigation never collapses to a bare spinner on a blank page.
 */
export default function Loading() {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <div className="h-13 border-b border-line bg-surface-raised/80" />
      <div className="mx-auto max-w-app px-5 py-8" aria-busy="true" aria-label="Loading">
        <div className="h-6 w-48 animate-pulse rounded-md bg-surface-sunken" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-sunken" />
          ))}
        </div>
      </div>
    </div>
  );
}
