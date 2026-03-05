import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function shouldRunMigration() {
  return (process.env.RUN_DB_MIGRATION ?? '').toLowerCase() === 'true';
}

function resolveSchemaPath() {
  const dbPackageJson = require.resolve('@sb/db/package.json');
  return join(dirname(dbPackageJson), 'prisma', 'schema.prisma');
}

function resolvePrismaCli() {
  const dbPackageJson = require.resolve('@sb/db/package.json');
  const dbRequire = createRequire(dbPackageJson);
  return dbRequire.resolve('prisma/build/index.js');
}

export async function runMigrationsIfEnabled() {
  if (!shouldRunMigration()) return;

  const schemaPath = resolveSchemaPath();
  const prismaCli = resolvePrismaCli();

  console.log('[startup] running prisma migrate deploy', { schemaPath });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`prisma migrate deploy failed with exit code ${code ?? 'null'}`));
    });
  });
}
