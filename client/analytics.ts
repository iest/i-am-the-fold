import posthog from "posthog-js";

export function startAnalytics(key: string) {
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: true,
  });
}
