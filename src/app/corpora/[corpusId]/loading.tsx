/** Corpus skeleton: nav bar height + title + search card + result rows. */
export default function CorpusLoading() {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <div className="h-13 border-b border-line bg-surface-raised/85" />
      <main
        aria-busy="true"
        aria-label="Loading collection"
        className="mx-auto max-w-app px-5 py-8"
      >
        <div className="h-7 w-56 animate-pulse rounded-md bg-surface-sunken" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-surface-sunken" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-sunken" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-sunken" />
          ))}
        </div>
      </main>
    </div>
  );
}
