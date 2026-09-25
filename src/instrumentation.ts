/**
 * Next.js Instrumentation Hook (server startup)
 *
 * Runs once when the server process boots. Validates that the deployment's
 * RPC configuration is internally consistent — most importantly that
 * SOLANA_RPC_URL actually serves the cluster named by SOLANA_NETWORK
 * (genesis hash check), so backend transactions can never silently target
 * a different cluster than the frontend wallet is connected to.
 *
 * Skipped during `next build` (phase-production-build): static prerendering
 * must not be killed by runtime-only env validation.
 */

export async function register() {
  // Suppress ONE known-benign third-party warning so server logs stay clean:
  // bigint-buffer (via @solana/web3.js) warns when its optional native
  // binding isn't compiled and falls back to pure JS. The pure-JS path is
  // functionally identical (all Solana flows verified against it) and
  // compiling the binding needs VS Build Tools — unreasonable to require.
  // Scoped to the exact string; every other warning passes through untouched.
  // TODO: drop when @solana/web3.js no longer depends on bigint-buffer.
  const BINDING_NOISE =
    'bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)';
  const origWarn = console.warn.bind(console);
  let warned = false;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes(BINDING_NOISE)) {
      if (!warned) {
        warned = true;
        origWarn('[bigint-buffer] native binding absent — using pure JS fallback (expected, harmless)');
      }
      return;
    }
    origWarn(...args);
  };

  // Only validate in the Node.js runtime (not edge, not browser),
  // and never during the build phase.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    // Fail-fast prod config validation (prevents fail-open lazy errors).
    // Only integrity-critical vars are fatal: CRON_SECRET is enforced
    // fail-closed per-request by guardCron (401 in prod when unset), so a
    // missing cron secret warns instead of bricking the whole app.
    if (process.env.NODE_ENV === 'production') {
      const missing: string[] = [];
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-in-production') missing.push('JWT_SECRET');
      if (!process.env.XENDIT_API_KEY) missing.push('XENDIT_API_KEY');
      if (process.env.BLOCKCHAIN_PROVIDER !== 'real') missing.push('BLOCKCHAIN_PROVIDER=real');
      if (missing.length) {
        console.error(`[instrumentation] FATAL: missing production env: ${missing.join(', ')}`);
        process.exit(1);
      }
      if (!process.env.CRON_SECRET) {
        console.error('[instrumentation] WARNING: CRON_SECRET not set — cron endpoints return 401 until configured');
      }
      if (!process.env.XENDIT_WEBHOOK_TOKEN) {
        console.error('[instrumentation] WARNING: XENDIT_WEBHOOK_TOKEN not set — webhooks rejected until configured');
      }
      if (!process.env.ADMIN_TOTP_SECRET) {
        console.error('[instrumentation] WARNING: ADMIN_TOTP_SECRET not set — admin 2FA disabled');
      }
    }
    const { validateNetworkConfig } = await import(
      './lib/blockchain/network'
    );
    try {
      await validateNetworkConfig();
      console.log('[instrumentation] network config OK');
    } catch (err) {
      console.error(
        '[instrumentation] FATAL: network configuration invalid —',
        err instanceof Error ? err.message : err,
      );
      // Fail fast: a deployment where backend and frontend could end up on
      // different clusters must not serve traffic.
      process.exit(1);
    }
  }
}
