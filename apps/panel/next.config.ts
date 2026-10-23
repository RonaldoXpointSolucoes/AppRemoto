import type { NextConfig } from 'next';

const defaultAppwriteEndpoint = 'https://appwrite.179.199.142.157.sslip.io/v1';
const defaultAppwriteProjectId = '69db52b70039b23be5c2';
const defaultApiBaseUrl = 'https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io';

const resolvedAppwriteEndpoint =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT &&
  !process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT.includes('aogc088s00c4osck8k0ks0c4')
    ? process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
    : defaultAppwriteEndpoint;

const resolvedAppwriteProjectId =
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID &&
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID !== '69db5246001f7f0ef0a9'
    ? process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID
    : defaultAppwriteProjectId;

const rawApiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || defaultApiBaseUrl).replace(/\/+$/, '');
const resolvedApiBaseUrl =
  rawApiBaseUrl.includes('api.179.199.142.157.sslip.io')
    ? defaultApiBaseUrl
    : rawApiBaseUrl;

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_APPWRITE_ENDPOINT: resolvedAppwriteEndpoint,
    NEXT_PUBLIC_APPWRITE_PROJECT_ID: resolvedAppwriteProjectId,
    NEXT_PUBLIC_API_BASE_URL: resolvedApiBaseUrl,
  },
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: `${resolvedApiBaseUrl}/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      { source: '/installers/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] },
      {
        source: '/((?!installers/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
          { key: 'Permissions-Policy', value: 'clipboard-write=(self *)' },
        ],
      },
    ];
  },
};

export default nextConfig;
