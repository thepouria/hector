import type { NextConfig } from 'next';
import path from 'node:path';

const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

const connectSrc = ["'self'", 'http://localhost:*', 'https://localhost:*'];
if (apiOrigin) {
  connectSrc.push(apiOrigin);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Production Docker image uses `output: 'standalone'` (see apps/web/Dockerfile).
  // Keep local `next start` / `next dev` unchanged when OUTPUT_STANDALONE is unset.
  ...(process.env.OUTPUT_STANDALONE === '1'
    ? {
        output: 'standalone' as const,
        // Monorepo: trace files from repository root so workspace deps resolve.
        outputFileTracingRoot: path.join(__dirname, '../..'),
      }
    : {}),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              `connect-src ${connectSrc.join(' ')}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
