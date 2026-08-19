import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  experimental: {
    // App Hosting builds run in a memory-limited container. Next otherwise
    // derives this from the host CPU count and can spawn enough page-data
    // workers to exhaust the container after compilation.
    cpus: 1,
  },
  outputFileTracingIncludes: {
    '/api/documents/templates/**': [
      './docs/modelos-documentos/admissionais/*.docx',
      './src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png',
      './src/features/hr/documents/assets/coala-shakes-letterhead-overlay-a4-v2.png',
      './node_modules/@fontsource/caladea/files/caladea-latin-400-normal.woff',
      './node_modules/@fontsource/caladea/files/caladea-latin-700-normal.woff',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
          },
        ],
      },
    ];
  },
  serverExternalPackages: [
    '@genkit-ai/core',
    '@genkit-ai/google-genai',
    '@genkit-ai/next',
    'express',
    'genkit',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.openfoodfacts.org' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }

    config.resolve.alias['@/components/dp-context'] = path.resolve(__dirname, 'src/components/dp-context.tsx');
    return config;
  },
};
export default nextConfig;
