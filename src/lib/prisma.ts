import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';

// Prisma Accelerate (HTTP) when DATABASE_URL is a prisma:// URL — required on
// Cloudflare Workers (no native engine binaries). Plain sqlite/postgres URLs
// (local dev) bypass Accelerate automatically.
const prismaClientSingleton = () =>
  new PrismaClient({ log: ['error'] }).$extends(withAccelerate());

type PrismaClientExtended = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientExtended;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
