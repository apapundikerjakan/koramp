// Seed runner — called via `npm run seed`
const { execSync } = require('child_process');
try {
  execSync('node node_modules/ts-node/dist/bin.js --transpile-only prisma/seed.ts', {
    stdio: 'inherit',
    env: { ...process.env },
  });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
