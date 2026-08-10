/**
 * The access console reads the request list on the server, so navigation can
 * pause on it. This keeps the page's shape on screen while that happens
 * instead of a blank frame.
 */
export default function AdminLoading() {
  return (
    <main className="min-h-screen flex-1 bg-white" aria-busy="true" aria-label="Loading access requests">
      <div className="w-full">
        <header className="page-header">
          <div className="skeleton h-8 w-40" />
          <div className="skeleton mt-3 h-4 w-96 max-w-full" />
        </header>
        <div className="page-body">
          <div className="table-wrap">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 border-b p-4 last:border-b-0"
                style={{ borderColor: "var(--line)" }}
              >
                <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
                <div className="skeleton h-4 flex-1" />
                <div className="skeleton h-6 w-20 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
