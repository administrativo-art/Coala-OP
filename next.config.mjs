/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true, // Mantendo sua config anterior
  },
  eslint: {
    ignoreDuringBuilds: true, // Mantendo sua config anterior
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'images.openfoodfacts.org' },
      { protocol: 'https', hostname: 'placehold.co' },
    ],
  },
  // Se o aviso de 'Unrecognized key' persistir e travar o dev, 
  // comente este bloco experimental.
  experimental: {
    allowedDevOrigins: [
      '6000-firebase-studio-1750786823522.cluster-duylic2g3fbzerqpzxxbw6helm.cloudworkstations.dev'
    ]
  },
};

export default nextConfig;
