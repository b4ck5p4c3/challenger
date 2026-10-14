import { PrismaPg } from '@prisma/adapter-pg'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { Decimal } from '@prisma/client/runtime/client'
import z from 'zod'

import { CrptAPI } from './api/crpt'
import { EdadealAPI } from './api/edadeal'
import { ScanService } from './application/scan-service'
import { ShuttleAdapter } from './shuttle/adapter'
import { getEnvironment } from './environment'
import { PrismaClient } from './generated/prisma/client'
import { getLogger } from './logger'
import { ShuttleClient, ShuttleServer } from './shuttle/protocol'

const logger = getLogger()
const environment = getEnvironment()
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }) })
const scanService = new ScanService(prisma, new CrptAPI(), new EdadealAPI())
const shuttleEndpoint = environment.SHUTTLE_CLIENT_HOST
  ? new ShuttleClient(environment.SHUTTLE_CLIENT_HOST, environment.SHUTTLE_CLIENT_PORT)
  : new ShuttleServer(environment.SHUTTLE_SERVER_PORT)
const shuttleAdapter = new ShuttleAdapter(shuttleEndpoint, input => scanService.process(input))

const app = express()
app.use(cors())
app.use(express.json())
const frontendDirectory = path.resolve(process.cwd(), environment.FRONTEND_DIR)
app.use(express.static(frontendDirectory))
app.use(express.static(path.join(process.cwd(), 'public')))

const scanRequest = z.object({
  adapterId: z.string().min(1).default('web'),
  codeType: z.enum(['ean13', 'chestny_znak']),
  correlationId: z.string().optional(),
  rawCode: z.string().min(1)
})

app.post('/api/scans', async (request, response) => {
  const parsed = scanRequest.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_SCAN_INPUT', msg: parsed.error.message, type: 'error' })
    return
  }
  response.json(await scanService.process({
    adapterId: parsed.data.adapterId,
    codeType: parsed.data.codeType,
    rawCode: parsed.data.rawCode,
    receivedAt: new Date(),
    ...(parsed.data.correlationId === undefined ? {} : { correlationId: parsed.data.correlationId })
  }))
})

app.get('/api/products', async (_, response) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { name: 'asc' } })
    response.json(products.map(serializeProduct))
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

const productCreate = z.object({
  alcohol: z.number().nonnegative(),
  brand: z.string().trim().min(1),
  caffeine: z.number().nonnegative(),
  name: z.string().trim().min(1),
  productCodeId: z.string().min(1).optional(),
  volume: z.number().nonnegative()
})

app.post('/api/products', async (request, response) => {
  const parsed = productCreate.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_PRODUCT', msg: parsed.error.message, type: 'error' })
    return
  }

  const productCodeId = parsed.data.productCodeId
  try {
    if (productCodeId) {
      const productCode = await prisma.productCode.findUnique({ where: { id: productCodeId } })
      if (!productCode) {
        response.status(404).json({ code: 'PRODUCT_CODE_NOT_FOUND', msg: 'ProductCode was not found', type: 'error' })
        return
      }
      if (productCode.productId) {
        response.status(409).json({ code: 'PRODUCT_CODE_ALREADY_ATTACHED', msg: 'ProductCode is already attached to a Product', type: 'error' })
        return
      }
    }

    const product = await prisma.$transaction(async transaction => {
      const created = await transaction.product.create({
        data: {
          alcohol: new Decimal(parsed.data.alcohol),
          brand: parsed.data.brand,
          caffeine: new Decimal(parsed.data.caffeine),
          name: parsed.data.name,
          volume: new Decimal(parsed.data.volume)
        }
      })
      if (productCodeId) {
        await transaction.productCode.update({
          data: { productId: created.id },
          where: { id: productCodeId }
        })
      }
      return created
    })
    response.status(201).json(serializeProduct(product))
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.get('/api/products/:id', async (request, response) => {
  try {
    const product = await prisma.product.findUnique({
      include: { productCodes: true },
      where: { id: request.params.id }
    })
    if (!product) {
      response.status(404).json({})
      return
    }
    response.json({ ...serializeProduct(product), productCodes: product.productCodes })
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

const productPatch = z.object({
  alcohol: z.number().nonnegative().optional(),
  brand: z.string().optional(),
  caffeine: z.number().nonnegative().optional(),
  name: z.string().optional(),
  volume: z.number().nonnegative().optional()
})

app.patch('/api/products/:id', async (request, response) => {
  const parsed = productPatch.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_PRODUCT', msg: parsed.error.message, type: 'error' })
    return
  }
  try {
    const product = await prisma.product.update({
      data: {
        ...(parsed.data.alcohol !== undefined && { alcohol: new Decimal(parsed.data.alcohol) }),
        ...(parsed.data.brand !== undefined && { brand: parsed.data.brand }),
        ...(parsed.data.caffeine !== undefined && { caffeine: new Decimal(parsed.data.caffeine) }),
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.volume !== undefined && { volume: new Decimal(parsed.data.volume) })
      },
      where: { id: request.params.id }
    })
    response.json(serializeProduct(product))
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

const productDelete = z.object({
  mode: z.enum(['product', 'product_with_history'])
})

app.delete('/api/products/:id', async (request, response) => {
  const parsed = productDelete.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_PRODUCT_DELETE', msg: parsed.error.message, type: 'error' })
    return
  }

  try {
    const product = await prisma.product.findUnique({ where: { id: request.params.id } })
    if (!product) {
      response.status(404).json({ code: 'PRODUCT_NOT_FOUND', msg: 'Product was not found', type: 'error' })
      return
    }

    await prisma.$transaction(async transaction => {
      const productCodes = await transaction.productCode.findMany({
        select: { id: true },
        where: { productId: product.id }
      })
      const productCodeIds = productCodes.map(productCode => productCode.id)

      if (parsed.data.mode === 'product_with_history') {
        if (productCodeIds.length > 0) {
          await transaction.scanUnit.deleteMany({ where: { productCodeId: { in: productCodeIds } } })
          await transaction.productCode.deleteMany({ where: { id: { in: productCodeIds } } })
        }
      } else {
        await transaction.productCode.updateMany({
          data: { productId: null },
          where: { productId: product.id }
        })
      }

      await transaction.product.delete({ where: { id: product.id } })
    })
    response.status(204).end()
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.get('/api/product-codes', async (_, response) => {
  response.json(await prisma.productCode.findMany({ orderBy: { gtin: 'asc' } }))
})

app.get('/api/product-codes/:id', async (request, response) => {
  const productCode = await prisma.productCode.findUnique({
    include: { product: true, scanUnits: true },
    where: { id: request.params.id }
  })
  if (!productCode) {
    response.status(404).json({})
    return
  }
  response.json(productCode)
})

const productCodePatch = z.object({
  productId: z.string().min(1)
})

app.patch('/api/product-codes/:id', async (request, response) => {
  const parsed = productCodePatch.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_PRODUCT_CODE', msg: parsed.error.message, type: 'error' })
    return
  }

  try {
    const [productCode, product] = await Promise.all([
      prisma.productCode.findUnique({ where: { id: request.params.id } }),
      prisma.product.findUnique({ where: { id: parsed.data.productId } })
    ])
    if (!productCode) {
      response.status(404).json({ code: 'PRODUCT_CODE_NOT_FOUND', msg: 'ProductCode was not found', type: 'error' })
      return
    }
    if (!product) {
      response.status(404).json({ code: 'PRODUCT_NOT_FOUND', msg: 'Product was not found', type: 'error' })
      return
    }

    const updated = await prisma.productCode.update({
      data: { productId: product.id },
      include: { product: true },
      where: { id: productCode.id }
    })
    response.json(updated)
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.get('/api/scan-units', async (request, response) => {
  const page = Math.max(1, Number.parseInt(String(request.query['page'] ?? '1')))
  const [scanUnits, total] = await Promise.all([
    prisma.scanUnit.findMany({
      include: { productCode: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 50,
      take: 50
    }),
    prisma.scanUnit.count()
  ])
  response.json({ scanUnits, total })
})

app.delete('/api/scan-units/:id', async (request, response) => {
  try {
    await prisma.scanUnit.delete({ where: { id: request.params.id } })
    response.status(204).end()
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.get('/api/scan-units/:id', async (request, response) => {
  const scanUnit = await prisma.scanUnit.findUnique({
    include: { productCode: { include: { product: true } } },
    where: { id: request.params.id }
  })
  if (!scanUnit) {
    response.status(404).json({})
    return
  }
  response.json(scanUnit)
})

app.get('/api/stats', async (_, response) => {
  try {
    const [day, month, total] = await Promise.all([
      calculateStats(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      calculateStats(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      calculateStats()
    ])
    response.json({ day, month, total })
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.use((request, response, next) => {
  const isApiRequest = request.path === '/api' || request.path.startsWith('/api/')
  const hasFileExtension = path.extname(request.path) !== ''
  if (request.method !== 'GET' || isApiRequest || hasFileExtension || !request.accepts('html')) {
    next()
    return
  }
  response.sendFile(path.join(frontendDirectory, 'index.html'), error => {
    if (error) next(error)
  })
})

function serializeProduct (product: { id: string; brand: string; name: string; volume: Decimal; caffeine: Decimal; alcohol: Decimal; createdAt: Date; updatedAt: Date }): Record<string, unknown> {
  return {
    alcohol: product.alcohol.toNumber(),
    brand: product.brand,
    caffeine: product.caffeine.toNumber(),
    createdAt: product.createdAt.toISOString(),
    id: product.id,
    name: product.name,
    updatedAt: product.updatedAt.toISOString(),
    volume: product.volume.toNumber()
  }
}

async function calculateStats (since?: Date) {
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

// fn main() { // >:P
app.listen(environment.WEB_SERVER_PORT, () => {
  logger.info(`started web server on :${environment.WEB_SERVER_PORT}`)
})

await shuttleAdapter.start()
// }
