/**
 * Reader skeleton. Mirrors the real layout — nav, hero with cover, toolbar,
 * then paragraph blocks — so navigating in does not flash an empty page or
 * shift the content once it lands.
 */
export default function ReaderLoading() {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <div className="h-13 border-b border-line bg-surface-raised/85" />

      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto max-w-reading px-5 py-8">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 flex-shrink-0 animate-pulse rounded-lg bg-surface-sunken" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-32 animate-pulse rounded bg-surface-sunken" />
              <div className="h-5 w-full animate-pulse rounded bg-surface-sunken" />
              <div className="h-5 w-2/3 animate-pulse rounded bg-surface-sunken" />
            </div>
          </div>
        </div>
      </header>

      <div className="h-11 border-b border-line" />

      <main
        aria-busy="true"
        aria-label="Loading reader"
        className="mx-auto max-w-reading space-y-4 px-5 py-8"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line bg-surface-raised p-4">
            <div className="h-3.5 w-24 animate-pulse rounded bg-surface-sunken" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-sunken" />
            <div className="h-4 w-11/12 animate-pulse rounded bg-surface-sunken" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-surface-sunken" />
          </div>
        ))}
      </main>
    </div>
  );
}
