/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  reactStrictMode: true,
  // Resolve o aviso de Cross Origin no Cloud Workstations
  experimental: {
    allowedDevOrigins: [
      '6000-firebase-studio-1750786823522.cluster-duylic2g3fbzerqpzxxbw6helm.cloudworkstations.dev'
    ]
  },
  // Ignora erros de build para acelerar o desenvolvimento
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'images.openfoodfacts.org' },
      { protocol: 'https', hostname: 'placehold.co' },
    ],
  },
};

module.exports = nextConfig;
