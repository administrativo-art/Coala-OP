import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  // `npm run verify` executa o lint antes do build. Evita repetir a mesma
  // análise no Next e inundar o log do CI com a dívida legada em warnings.
  eslint: {
    ignoreDuringBuilds: true,
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
