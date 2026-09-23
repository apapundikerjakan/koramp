// Type declarations for packages without bundled types

declare module 'bs58' {
  export function encode(buffer: Buffer | Uint8Array): string;
  export function decode(string: string): Buffer;

  const bs58: {
    encode: typeof encode;
    decode: typeof decode;
  };
  export default bs58;
}