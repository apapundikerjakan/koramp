/**
 * KIPRAMP Seed — wallet-first architecture, no user accounts for customers.
 * Populates: Networks, Assets, PlatformWallets, FeeConfig, SystemSettings, AdminUser.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding KIPRAMP database (wallet-first)...');

  // ── NETWORKS ────────────────────────────────────────────────────────────────
  const solNet = await prisma.network.upsert({
    where: { networkId: 'SOLANA' },
    create: { networkId: 'SOLANA', name: 'Solana', displayName: 'Solana Network', explorerUrl: 'https://solscan.io' },
    update: { isActive: true },
  });
  const baseNet = await prisma.network.upsert({
    where: { networkId: 'BASE' },
    create: { networkId: 'BASE', name: 'Base', displayName: 'Base Network', chainId: '8453', explorerUrl: 'https://basescan.org' },
    update: { isActive: true },
  });
  const bscNet = await prisma.network.upsert({
    where: { networkId: 'BSC' },
    create: { networkId: 'BSC', name: 'BNB Smart Chain', displayName: 'BNB Smart Chain', chainId: '56', explorerUrl: 'https://bscscan.com' },
    update: { isActive: true },
  });
  console.log('✓ Networks: SOLANA, BASE, BSC');

  // ── ASSETS ──────────────────────────────────────────────────────────────────
  await prisma.asset.upsert({
    where: { symbol: 'SOL' },
    create: { symbol: 'SOL', name: 'Solana', decimals: 9, networkId: solNet.id },
    update: {},
  });
  await prisma.asset.upsert({
    where: { symbol: 'ETH' },
    create: { symbol: 'ETH', name: 'Ethereum (Base)', decimals: 18, networkId: baseNet.id },
    update: {},
  });
  await prisma.asset.upsert({
    where: { symbol: 'BNB' },
    create: { symbol: 'BNB', name: 'BNB', decimals: 18, networkId: bscNet.id },
    update: {},
  });
  console.log('✓ Assets: SOL, ETH (Base), BNB');

  // ── PLATFORM WALLETS ────────────────────────────────────────────────────────
  // These are KIPRAMP hot wallets — addresses are set from private keys in env
  // In dev mode, placeholder addresses are used
  const solanaKey = process.env.SOLANA_PLATFORM_PRIVATE_KEY;
  const baseKey = process.env.BASE_PLATFORM_PRIVATE_KEY;

  // Get EVM address from private key if available
  let evmAddress = '0x0000000000000000000000000000000000000001';
  try {
    if (baseKey) {
      const { ethers } = await import('ethers');
      const k = baseKey.startsWith('0x') ? baseKey : `0x${baseKey}`;
      evmAddress = new ethers.Wallet(k).address;
    }
  } catch {}

  await prisma.platformWallet.upsert({
    where: { id: 'pwallet-sol' },
    create: { id: 'pwallet-sol', networkId: solNet.id, address: 'SOLANA_PLATFORM_ADDRESS_CONFIGURE_IN_ENV', label: 'Solana Hot Wallet' },
    // Simpan address asli (turunan SOLANA_PLATFORM_PRIVATE_KEY) bila valid,
    // agar record konsisten dengan getDepositAddress().
    update: (() => {
      try {
        // bs58 v6 ESM: decode bisa di root atau .default tergantung loader.
        const bs58mod = require('bs58');
        const decode = bs58mod.decode ?? bs58mod.default?.decode;
        const { Keypair } = require('@solana/web3.js');
        const raw = (solanaKey ?? '').trim();
        if (typeof decode !== 'function' || !raw) return {};
        const decoded = decode(raw);
        if (decoded.length === 64) {
          return { address: Keypair.fromSecretKey(decoded).publicKey.toBase58() };
        }
      } catch {}
      return {};
    })(),
  });
  await prisma.platformWallet.upsert({
    where: { id: 'pwallet-base' },
    create: { id: 'pwallet-base', networkId: baseNet.id, address: evmAddress, label: 'Base Hot Wallet' },
    update: {},
  });
  await prisma.platformWallet.upsert({
    where: { id: 'pwallet-bsc' },
    create: { id: 'pwallet-bsc', networkId: bscNet.id, address: evmAddress, label: 'BSC Hot Wallet' },
    update: {},
  });
  console.log('✓ Platform wallets configured');

  // ── FEE CONFIG ──────────────────────────────────────────────────────────────
  const feeDefaults = [
    { assetSymbol: 'SOL', type: 'TOP_UP', min: 50000, max: 100000000 },
    { assetSymbol: 'SOL', type: 'SELL',   min: 50000, max: 100000000 },
    { assetSymbol: 'ETH', type: 'TOP_UP', min: 50000, max: 100000000 },
    { assetSymbol: 'ETH', type: 'SELL',   min: 50000, max: 100000000 },
    { assetSymbol: 'BNB', type: 'TOP_UP', min: 50000, max: 100000000 },
    { assetSymbol: 'BNB', type: 'SELL',   min: 50000, max: 100000000 },
  ];
  for (const f of feeDefaults) {
    await prisma.feeConfig.upsert({
      where: { assetSymbol_type: { assetSymbol: f.assetSymbol, type: f.type } },
      create: { assetSymbol: f.assetSymbol, type: f.type, serviceFeeRate: 0.005, taxRate: 0.001, networkFeeRate: 0.001, minOrderIdr: f.min, maxOrderIdr: f.max },
      update: {},
    });
  }
  console.log('✓ Fee configs: 0.5% service + 0.1% tax + 0.1% network per asset');

  // ── MARKET PRICES (dev fallback — replace with live oracle in production) ───
  const mockPrices = [
    { key: 'price_sol_idr', value: '2800000' },   // ~$175 × 16000
    { key: 'price_eth_idr', value: '60000000' },  // ~$3750 × 16000
    { key: 'price_bnb_idr', value: '10000000' },  // ~$625 × 16000
  ];
  for (const p of mockPrices) {
    await prisma.systemSetting.upsert({
      where: { key: p.key },
      create: { key: p.key, value: p.value },
      update: {},
    });
  }
  console.log('✓ Dev market prices set (replace with live oracle for production)');

  // ── ADMIN ACCESS KEY ──────────────────────────────────────────────────────────
  // Generate admin key untuk development/testing
  // Di production, generate ulang dari dashboard (/admin → Access Key)
  // atau via CLI: npm run admin:setup
  
  if (process.env.ADMIN_ACCESS_KEY) {
    // Import hashKey dari library adminAuth
    const crypto = require('crypto');
    const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');
    const verifier = hashKey(process.env.ADMIN_ACCESS_KEY);
    
    const existing = await prisma.adminAccessKey.findUnique({ where: { keyVerifier: verifier } });
    if (!existing) {
      await prisma.adminAccessKey.create({
        data: {
          keyVerifier: verifier,
          isActive: true,
          keyVersion: 1,
        },
      });
      console.log('✓ Admin Access Key configured (dev mode)');
      console.log('  Run /admin/login with the key from .env');
    } else {
      console.log('✓ Admin Access Key already exists');
    }
  } else {
    console.log('⚠ No ADMIN_ACCESS_KEY in .env — admin login not configured');
    console.log('  Generate ulang dari dashboard (/admin → Access Key) atau: npm run admin:setup');
  }

  console.log('\nSeed complete. KIPRAMP is ready.');
  console.log('Customer flow: Connect Wallet → Top Up or Sell (no account needed)');
  console.log('Admin flow:    POST /api/admin/login with 64-char hex Access Key');
}

main()
  .catch(e => { console.error('Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
