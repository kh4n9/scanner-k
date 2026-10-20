/**
 * Canonical origin for metadata, robots and the sitemap.
 *
 * `NEXT_PUBLIC_SITE_URL` wins when set. On Vercel, the production domain is
 * injected automatically, so a deploy without that env var still emits the real
 * URL instead of localhost.
 */
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
