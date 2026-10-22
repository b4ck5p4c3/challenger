import type { PrismaClient } from '../generated/prisma/client'
import type { ScanStats, StatsPeriod } from '../domain/scanning'

export async function getScanStats (prisma: PrismaClient): Promise<ScanStats> {
  const now = Date.now()
  const [day, month, total] = await Promise.all([
    calculateStats(prisma, new Date(now - 24 * 60 * 60 * 1000)),
    calculateStats(prisma, new Date(now - 30 * 24 * 60 * 60 * 1000)),
    calculateStats(prisma)
  ])
  return { day, month, total }
}

async function calculateStats (prisma: PrismaClient, since?: Date): Promise<StatsPeriod> {
  const rows = await prisma.$queryRaw<Array<{ alcohol: string | null; caffeine: string | null; volume: string | null }>>`
    SELECT
      COALESCE(sum(products.volume), 0) AS "volume",
      COALESCE(sum(products.alcohol), 0) AS "alcohol",
      COALESCE(sum(products.caffeine), 0) AS "caffeine"
    FROM scan_units
    JOIN product_codes ON product_codes.id = scan_units.product_code_id
    JOIN products ON products.id = product_codes.product_id
    WHERE (${since ?? null}::timestamp IS NULL OR scan_units.created_at >= ${since ?? null})
  `
  const row = rows[0]
  return {
    alcohol: Number(row?.alcohol ?? 0),
    caffeine: Number(row?.caffeine ?? 0),
    volume: Number(row?.volume ?? 0)
  }
}
