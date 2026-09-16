import crypto from 'crypto';
import { BlockchainProvider, TxInfo } from './types';

/**
 * Validasi address untuk mock provider.
 * Di mode mock, kita tetap melakukan validasi format dasar
 * agar konsisten dengan real provider.
 */
function isValidMockAddress(addr: string, networkName: string): boolean {
  if (!addr || addr.length < 10) return false;
  
  if (networkName === 'SOLANA') {
    // Solana address: base58, 32-44 karakter
    const solanaChars = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return solanaChars.test(addr) && addr.length >= 32 && addr.length <= 44;
  }
  
  if (networkName === 'BASE' || networkName === 'BSC') {
    // EVM address: 0x + 40 hex characters
    const evmPattern = /^0x[a-fA-F0-9]{40}$/;
    return evmPattern.test(addr);
  }
  
  return false;
}

export function createMockProvider(networkName: string): BlockchainProvider {
  return {
    network: networkName,
    isValidAddress: (addr) => isValidMockAddress(addr, networkName),
    getDepositAddress: (orderId) => {
      const h = crypto.createHash('sha256').update(orderId + networkName).digest('hex');
      return networkName === 'SOLANA' ? h.substring(0, 44) : '0x' + h.substring(0, 40);
    },
    getBalance: async () => '100.0',
    getTransaction: async (txHash) => ({ 
      txHash, 
      confirmations: 10, 
      isConfirmed: false, 
      amount: '1.0', 
      from: 'mock-sender', 
      to: 'mock-receiver', 
      network: networkName 
    }),
    getConfirmations: async () => 0,
    sendTransaction: async (to, amount) => ({ 
      txHash: `mock-tx-${crypto.randomBytes(16).toString('hex')}` 
    }),
  };
}
