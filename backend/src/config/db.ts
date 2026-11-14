import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  const code = (err as { code?: string })?.code;
  return (
    code === 'P1001' ||
    code === 'P1002' ||
    code === 'P1008' ||
    code === 'P1017' ||
    code === 'P2024' ||
    code === 'P2028' ||
    msg.includes('Server has closed the connection') ||
    msg.includes('Connection reset') ||
    msg.includes("Can't reach database server") ||
    msg.includes('Unable to start a transaction in the given time') ||
    msg.includes('Timed out fetching a new connection')
  );
}

async function reconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
    await prisma.$connect();
  } catch {
    // ignore reconnect error and let the caller retry
  }
}

// 1. Retry regular queries if the cloud pooler closed an idle connection
if (typeof prisma.$use === 'function') {
  prisma.$use(async (params, next) => {
    try {
      return await next(params);
    } catch (err: unknown) {
      if (isTransientDbError(err)) {
        await reconnectPrisma();
        return await next(params);
      }
      throw err;
    }
  });
}

// 2. Wrap interactive prisma.$transaction with generous cloud timeouts (15s maxWait / 30s timeout)
// and automatic retry if starting a transaction hits a stale/closed pooler socket.
if (typeof prisma.$transaction === 'function') {
  const origTransaction = prisma.$transaction.bind(prisma);
  (prisma as any).$transaction = async (arg: any, options?: any) => {
    if (typeof arg === 'function') {
      const mergedOptions = {
        maxWait: 15000,
        timeout: 30000,
        ...(options || {}),
      };
      try {
        return await origTransaction(arg, mergedOptions);
      } catch (err: unknown) {
        if (isTransientDbError(err)) {
          await reconnectPrisma();
          return await origTransaction(arg, mergedOptions);
        }
        throw err;
      }
    }
    try {
      return await origTransaction(arg, options);
    } catch (err: unknown) {
      if (isTransientDbError(err)) {
        await reconnectPrisma();
        return await origTransaction(arg, options);
      }
      throw err;
    }
  };
}

// 3. Keep the Supabase Supavisor connection warm so idle sockets are not dropped after 60s
if (process.env.NODE_ENV !== 'test' && typeof prisma.$queryRawUnsafe === 'function') {
  const timer = setInterval(() => {
    prisma.$queryRawUnsafe('SELECT 1').catch(() => {});
  }, 45000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}
