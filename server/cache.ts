const FIVE_MINUTES = 5 * 60 * 1000;

// Share one render between concurrent requests, and keep serving the previous
// page during refreshes. Challenges and submissions never pass through this cache.
export function createPageCache(
  render: () => Promise<string>,
  now = Date.now,
  onError: (error: unknown) => void = error => console.error("Page refresh failed", error),
) {
  let cached: string | undefined;
  let refreshAfter = 0;
  let pending: Promise<string> | undefined;

  function refresh() {
    if (!pending) {
      pending = render().then(html => {
        cached = html;
        refreshAfter = now() + FIVE_MINUTES;
        return html;
      }).catch(error => {
        refreshAfter = now() + 5000;
        throw error;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  }

  return async () => {
    if (cached === undefined) return refresh();
    if (now() >= refreshAfter && !pending) void refresh().catch(onError);
    return cached;
  };
}
