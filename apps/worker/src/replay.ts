import 'dotenv/config';
import { PrismaClient, InboxStatus, OutboxStatus } from '@prisma/client';

const prisma = new PrismaClient();

function must(v: string | undefined, name: string) {
  if (!v) throw new Error(`Missing arg/env: ${name}`);
  return v;
}

// Usage examples:
// pnpm -C apps/worker replay:inbox -- --status FAILED --limit 50 --resetAttempts true
// pnpm -C apps/worker replay:inbox -- --sourceEventId evt_bad_1 --resetAttempts true
// pnpm -C apps/worker replay:outbox -- --status FAILED --limit 50 --resetAttempts true
type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}

async function replayInbox(args: Args) {
  const sourceEventId = args.sourceEventId;
  const status = (args.status as InboxStatus | undefined) ?? InboxStatus.FAILED;
  const limit = Number(args.limit ?? '100');
  const resetAttempts = (args.resetAttempts ?? 'false') === 'true';

  const where = sourceEventId ? { sourceEventId } : { status };

  const rows = await prisma.inboxEvent.findMany({
    where: where as any,
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  for (const r of rows) {
    await prisma.inboxEvent.update({
      where: { id: r.id },
      data: {
        status: InboxStatus.PENDING,
        availableAt: new Date(),
        lastError: null,
        attempts: resetAttempts ? 0 : r.attempts,
      },
    });
  }

  console.log('[replay] inbox updated', { count: rows.length, where, resetAttempts });
}

async function replayOutbox(args: Args) {
  const status = (args.status as OutboxStatus | undefined) ?? OutboxStatus.FAILED;
  const limit = Number(args.limit ?? '100');
  const resetAttempts = (args.resetAttempts ?? 'false') === 'true';

  const rows = await prisma.outboxEvent.findMany({
    where: { status },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  for (const r of rows) {
    await prisma.outboxEvent.update({
      where: { id: r.id },
      data: {
        status: OutboxStatus.PENDING,
        availableAt: new Date(),
        lastError: null,
        attempts: resetAttempts ? 0 : r.attempts,
        sentAt: null,
      },
    });
  }

  console.log('[replay] outbox updated', { count: rows.length, status, resetAttempts });
}

async function main() {
  const cmd = must(process.argv[2], 'cmd');
  const args = parseArgs(process.argv.slice(3));

  if (cmd === 'inbox') await replayInbox(args);
  else if (cmd === 'outbox') await replayOutbox(args);
  else throw new Error(`Unknown cmd: ${cmd}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
