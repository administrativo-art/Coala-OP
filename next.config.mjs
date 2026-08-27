import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const documentPdfRuntimeAssets = [
  './src/features/hr/documents/assets/coala-shakes-letterhead-overlay-a4-v2.png',
  './node_modules/@fontsource/caladea/files/caladea-latin-400-normal.woff',
  './node_modules/@fontsource/caladea/files/caladea-latin-700-normal.woff',
];
const systemDocumentTemplateAssets = [
  './docs/modelos-documentos/**/*.docx',
  './src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png',
  ...documentPdfRuntimeAssets,
];
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  // `npm run verify` executes the repository lint before building. Avoid the
  // deprecated Next.js build-time lint pass duplicating that work and flooding
  // CI with the explicitly baselined warnings from legacy code.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // App Hosting builds run in a memory-limited container. Next otherwise
    // derives this from the host CPU count and can spawn enough page-data
    // workers to exhaust the container after compilation.
    cpus: 1,
  },
  outputFileTracingIncludes: {
    '/api/hr/onboarding/*/aso-workflow': [
      './public/coala-email-logo.jpg',
      './public/email/icons/file-text-pink.png',
      './public/email/icons/calendar-days-white.png',
      './public/email/icons/boxes/file-text-pink-14-in-28-fff0f6-r8.png',
      './public/email/icons/boxes/stethoscope-white-20-in-36-28b3d0-r11.png',
      './public/email/icons/boxes/building-2-pink-14-in-28-fff0f6-r9.png',
      './public/email/icons/boxes/user-round-pink-14-in-28-fff0f6-r9.png',
    ],
    '/api/hr/onboarding/*/aso-guide': [
      './src/features/hr/aso/assets/medclinc-logo.jpg',
      './src/features/hr/aso/assets/coala-shakes-letterhead-v1.png',
    ],
    '/api/hr/onboarding/*/accountant-form': [
      ...documentPdfRuntimeAssets,
    ],
    '/api/hr/onboarding/*/signature-documents': systemDocumentTemplateAssets,
    '/api/documents/generate': systemDocumentTemplateAssets,
    '/api/documents/generated/*': documentPdfRuntimeAssets,
    '/api/documents/templates/**': systemDocumentTemplateAssets,
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
    // Server-side PDF routes use this isolated package alias so the renderer
    // resolves the application's React 18 runtime instead of Next's vendored
    // React reconciler. The browser renderer remains transpiled normally.
    'react-pdf-renderer-server',
    'react-pdf-react-server',
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
