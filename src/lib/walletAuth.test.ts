import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import {
  createChallenge,
  verifyChallenge,
  issueWalletSession,
  verifyWalletSession,
  buildChallengeMessage,
  setChallengeStore,
  MemoryChallengeStore,
} from './walletAuth';

beforeAll(() => {
  // Unit tests run against the memory store (no DB). Production default is Prisma.
  setChallengeStore(new MemoryChallengeStore());
});

const EVM_WALLET = new ethers.Wallet('0x' + '11'.repeat(32));
const EVM_WALLET_B = new ethers.Wallet('0x' + '22'.repeat(32));
const SOL_KP = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const SOL_B58 = (() => {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = Array.from(SOL_KP.publicKey);
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of bytes) { if (b !== 0) break; out += '1'; }
  return out + digits.reverse().map((d) => ALPHABET[d]).join('');
})();
const toHex = (u8: Uint8Array) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');

describe('challenge lifecycle', () => {
  test('EVM: sign → verify OK', async () => {
    const c = await createChallenge(EVM_WALLET.address, 'EVM', 'REWARD_CLAIM');
    const sig = await EVM_WALLET.signMessage(c.message);
    const v = await verifyChallenge(c.id, sig);
    expect(v.walletAddress).toBe(EVM_WALLET.address.toLowerCase());
  });

  test('Solana: sign → verify OK', async () => {
    const c = await createChallenge(SOL_B58, 'SOLANA', 'SUPPORT');
    const sig = toHex(nacl.sign.detached(new TextEncoder().encode(c.message), SOL_KP.secretKey));
    const v = await verifyChallenge(c.id, sig);
    expect(v.walletAddress).toBe(SOL_B58); // base58 is case-sensitive: never lowercased
  });

  test('solana mixed-case address is preserved, not normalized', async () => {
    const c = await createChallenge(SOL_B58, 'SOLANA', 'SUPPORT');
    expect(c.walletAddress).toBe(SOL_B58);
    expect(c.message).toContain(SOL_B58);
  });

  test('replay: same signature twice → second fails', async () => {
    const c = await createChallenge(EVM_WALLET.address, 'EVM', 'SUPPORT');
    const sig = await EVM_WALLET.signMessage(c.message);
    await verifyChallenge(c.id, sig);
    await expect(verifyChallenge(c.id, sig)).rejects.toMatchObject({ code: 'CHALLENGE_REUSED' });
  });

  test('concurrent double-submit: one wins', async () => {
    const c = await createChallenge(EVM_WALLET.address, 'EVM', 'SUPPORT');
    const sig = await EVM_WALLET.signMessage(c.message);
    const [a, b] = await Promise.allSettled([verifyChallenge(c.id, sig), verifyChallenge(c.id, sig)]);
    const okCount = [a, b].filter((r) => r.status === 'fulfilled').length;
    expect(okCount).toBe(1);
  });

  test('expired challenge rejected', async () => {
    const c = await createChallenge(EVM_WALLET.address, 'EVM', 'SUPPORT', { ttlMs: -1 });
    const sig = await EVM_WALLET.signMessage(c.message);
    await expect(verifyChallenge(c.id, sig)).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
  });

  test('wrong wallet signature rejected', async () => {
    const c = await createChallenge(EVM_WALLET.address, 'EVM', 'REWARD_CLAIM');
    const sig = await EVM_WALLET_B.signMessage(c.message);
    await expect(verifyChallenge(c.id, sig)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  test('tampered message cannot validate (server rebuilds message)', async () => {
    const c = await createChallenge(EVM_WALLET.address, 'EVM', 'REWARD_CLAIM');
    const tampered = buildChallengeMessage({
      walletAddress: EVM_WALLET_B.address, ecosystem: 'EVM', purpose: 'REWARD_CLAIM',
      nonce: 'ff'.repeat(16), expiresAt: Date.now() + 60000,
    });
    const sig = await EVM_WALLET_B.signMessage(tampered);
    await expect(verifyChallenge(c.id, sig)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  test('EVM signature against Solana challenge rejected and vice versa', async () => {
    const cSol = await createChallenge(SOL_B58, 'SOLANA', 'SUPPORT');
    const evmSig = await EVM_WALLET.signMessage(cSol.message);
    await expect(verifyChallenge(cSol.id, evmSig)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    const cEvm = await createChallenge(EVM_WALLET.address, 'EVM', 'SUPPORT');
    const solSig = toHex(nacl.sign.detached(new TextEncoder().encode(cEvm.message), SOL_KP.secretKey));
    await expect(verifyChallenge(cEvm.id, solSig)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  test('unknown challenge id rejected', async () => {
    await expect(verifyChallenge('nope', '0x1234')).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' });
  });
});

describe('session tokens', () => {
  test('valid token verifies with purpose', () => {
    const { token } = issueWalletSession({ walletAddress: EVM_WALLET.address, ecosystem: 'EVM', purpose: 'REWARD_CLAIM' });
    const s = verifyWalletSession(token, 'REWARD_CLAIM');
    expect(s.walletAddress).toBe(EVM_WALLET.address.toLowerCase());
  });

  test('cross-purpose rejected', () => {
    const { token } = issueWalletSession({ walletAddress: EVM_WALLET.address, ecosystem: 'EVM', purpose: 'REWARD_CLAIM' });
    expect(() => verifyWalletSession(token, 'SUPPORT')).toThrow();
  });

  test('tampered token rejected', () => {
    const { token } = issueWalletSession({ walletAddress: EVM_WALLET.address, ecosystem: 'EVM', purpose: 'SUPPORT' });
    const [body] = token.split('.');
    const fake = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    fake.w = EVM_WALLET_B.address.toLowerCase();
    const forged = `${Buffer.from(JSON.stringify(fake)).toString('base64url')}.${token.split('.')[1]}`;
    expect(() => verifyWalletSession(forged, 'SUPPORT')).toThrow();
  });

  test('expired token rejected', () => {
    const { token } = issueWalletSession(
      { walletAddress: EVM_WALLET.address, ecosystem: 'EVM', purpose: 'SUPPORT' },
      { ttlMs: -1 },
    );
    expect(() => verifyWalletSession(token, 'SUPPORT')).toThrow();
  });

  test('malformed token rejected', () => {
    expect(() => verifyWalletSession('garbage', 'SUPPORT')).toThrow();
    expect(() => verifyWalletSession('', 'SUPPORT')).toThrow();
  });
});
