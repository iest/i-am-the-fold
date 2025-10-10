// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  // If you have other existing config options, you can add them here

  // Rewrites required for PostHog ingestion endpoints
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ];
  },

  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

module.exports = nextConfig;
