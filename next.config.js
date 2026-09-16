/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// Content-Security-Policy tuned for KIPRAMP's wallet stack:
// - RainbowKit/WalletConnect/Solana adapters are fully bundled (no external
//   <script> needed) — script-src stays 'self' (+ 'unsafe-eval' in dev only,
//   required by Next dev; never in production).
// - connect-src allows https+wss for WalletConnect relay + RPC endpoints.
// - img-src allows data:/blob: (wallet icons, QR) + https (proxied QR fallback).
// - style-src 'unsafe-inline' required by RainbowKit/emotion-style injection.
const cspDirectives = [
  "default-src 'self'",
  isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,

  async headers() {
    const headers = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: cspDirectives },
    ];
    if (isProd) {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }
    return [{ source: '/(.*)', headers }];
  },

  experimental: {
    // Required: keeps Prisma/bcrypt native code out of the server bundle trace.
    // @solana/web3.js + ethers are ESM-heavy; marking external avoids
    // bundling them into route handlers unnecessarily (P6 — kept, not obsolete).
    serverComponentsExternalPackages: [
      '@prisma/client',
      'prisma',
      'bcryptjs',
      '@solana/web3.js',
      'ethers',
      'bs58',
    ],
  },

  webpack: (config, { isServer }) => {
    // Required: winston/pino optional deps (encoding, pino-pretty) must not break build.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      encoding: false,
      'pino-pretty': false,
    };

    if (isServer) {
      // Required: Solana wallet adapters optionally import mobile/react-native shims.
      // Aliasing to false prevents SSR from pulling react-native into server bundle.
      // Kept with explanation (P6) — removing breaks `next build` with
      // "Module not found: react-native".
      config.resolve.alias = {
        ...config.resolve.alias,
        '@solana-mobile/wallet-adapter-mobile$': false,
        '@solana-mobile/wallet-standard-mobile$': false,
        'react-native$': false,
      };
    }

    // P6/P29: do NOT suppress "Critical dependency" warnings to hide problems.
    // Surface them so underlying dynamic-require issues stay visible.
    return config;
  },
};

module.exports = nextConfig;
