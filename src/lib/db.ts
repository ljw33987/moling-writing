import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// SQLite 并发加固：开启 WAL 模式与忙等待超时，避免高并发写入时报 SQLITE_BUSY
const globalForPragma = globalThis as unknown as { __molingSqliteWalInit?: boolean }
if (!globalForPragma.__molingSqliteWalInit) {
  globalForPragma.__molingSqliteWalInit = true
  Promise.resolve()
    .then(() => db.$executeRawUnsafe('PRAGMA journal_mode = WAL;'))
    .then(() => db.$executeRawUnsafe('PRAGMA busy_timeout = 5000;'))
    .catch(() => {})
}
