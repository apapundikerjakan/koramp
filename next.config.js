/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// Content-Security-Policy tuned for KIPRAMP's wallet stack + TradingView embeds:
// - RainbowKit/WalletConnect/Solana adapters are fully bundled (no external
//   <script> needed) — script-src stays 'self' (+ 'unsafe-eval' in dev only,
//   required by Next dev; never in production) PLUS s3.tradingview.com for the
//   official TradingView embed widgets (order-flow charts, no API key).
// - frame-src allows the TradingView widget origins (verified against the
//   actual embed loader source): widget iframes are served from
//   https://www.tradingview-widget.com (NOT www.tradingview.com) with an
//   s.tradingview.com CSP fallback — all three must be allowlisted or the
//   chart iframe is blocked and renders an empty box. X-Frame-Options /
//   frame-ancestors only restrict framing OUR pages elsewhere — unaffected.
// - connect-src allows https+wss for WalletConnect relay + RPC endpoints.
// - img-src allows data:/blob: (wallet icons, QR) + https (proxied QR fallback).
// - style-src 'unsafe-inline' required by RainbowKit/emotion-style injection.
const cspDirectives = [
  "default-src 'self'",
  isProd
    ? "script-src 'self' 'unsafe-inline' https://s3.tradingview.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'self' https://www.tradingview.com https://www.tradingview-widget.com https://s.tradingview.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,

  // Required: RainbowKit/wagmi/viem ship ESM barrels (`export * from
  // 'viem/chains' chain). Without transpilation, webpack's static export
  // analysis fails with "'mainnet' is not exported from 'wagmi/chains'".
  transpilePackages: [
    '@rainbow-me/rainbowkit',
    'wagmi',
    'viem',
    '@solana/wallet-adapter-react-ui',
    '@base-org/account',
    '@coinbase/cdp-sdk',
    '@x402/core',
    '@x402/evm',
    '@x402/svm',
    '@x402/fetch',
    '@x402/express',
    '@x402/extensions',
  ],

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
    // Required: enables src/instrumentation.ts (network/cluster validation
    // at boot — previously dead: file sat at project root where Next never
    // discovers it, and this flag was missing).
    instrumentationHook: true,
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

    // Required: @metamask/sdk (transitive via @wagmi/connectors metaMask —
    // used by RainbowKit, cannot be uninstalled) statically imports the
    // React Native storage shim in its browser build. Web never touches that
    // code path (extension/mobile-SDK flows use their own storage), so alias
    // it to an empty module instead of installing RN packages for web.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    // P6/P29: do NOT suppress "Critical dependency" warnings to hide problems.
    // Surface them so underlying dynamic-require issues stay visible.
    return config;
  },
};

module.exports = nextConfig;
