import { PrismaPg } from '@prisma/adapter-pg'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { Decimal } from '@prisma/client/runtime/client'
import z from 'zod'

import { CrptAPI } from './api/crpt'
import { EdadealAPI } from './api/edadeal'
import { ScanService } from './application/scan-service'
import { getScanStats } from './application/statistics'
import { escapeSpecialCharacters, scanSituations, type ScanTemplateScanUnit } from './domain/scanning'
import { ShuttleAdapter } from './shuttle/adapter'
import { getEnvironment } from './environment'
import { PrismaClient } from './generated/prisma/client'
import { getLogger } from './logger'
import { ShuttleClient, ShuttleServer } from './shuttle/protocol'
import { ShuttleTemplateRenderer } from './shuttle/template-renderer'

const logger = getLogger()
const environment = getEnvironment()
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }) })
const crptAPI = new CrptAPI()
const scanService = new ScanService(prisma, crptAPI, new EdadealAPI())
const shuttleEndpoint = environment.SHUTTLE_CLIENT_HOST
  ? new ShuttleClient(environment.SHUTTLE_CLIENT_HOST, environment.SHUTTLE_CLIENT_PORT)
  : new ShuttleServer(environment.SHUTTLE_SERVER_PORT)
const shuttleTemplateRenderer = new ShuttleTemplateRenderer(prisma)
const shuttleAdapter = new ShuttleAdapter(
  shuttleEndpoint,
  input => scanService.process(input),
  () => getScanStats(prisma),
  readScanUnitForTemplate,
  (shuttle, context) => shuttleTemplateRenderer.send(shuttle, context)
)

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
    rawCode: escapeSpecialCharacters(parsed.data.rawCode),
    receivedAt: new Date(),
    ...(parsed.data.correlationId === undefined ? {} : { correlationId: parsed.data.correlationId })
  }))
})

const shuttleTemplateCreate = z.object({
  enabled: z.boolean().default(true),
  name: z.string().trim().min(1),
  situation: z.enum(scanSituations),
  template: z.string().min(1)
})

const shuttleTemplatePatch = shuttleTemplateCreate.partial()
const shuttleTemplateState = z.object({ enabled: z.boolean() })

app.get('/api/shuttle-templates', async (_, response) => {
  response.json(await prisma.shuttleTemplate.findMany({
    orderBy: [{ situation: 'asc' }, { createdAt: 'asc' }]
  }))
})

app.post('/api/shuttle-templates', async (request, response) => {
  const parsed = shuttleTemplateCreate.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_SHUTTLE_TEMPLATE', msg: parsed.error.message, type: 'error' })
    return
  }

  try {
    const template = await prisma.shuttleTemplate.create({ data: parsed.data })
    response.status(201).json(template)
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.patch('/api/shuttle-templates/state', async (request, response) => {
  const parsed = shuttleTemplateState.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_SHUTTLE_TEMPLATE_STATE', msg: parsed.error.message, type: 'error' })
    return
  }
  if (!parsed.data.enabled) {
    response.status(409).json({ code: 'ALL_SHUTTLE_TEMPLATES_DISABLED', msg: 'At least one Shuttle template must remain enabled', type: 'error' })
    return
  }

  try {
    await prisma.shuttleTemplate.updateMany({ data: { enabled: true } })
    response.status(204).end()
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.patch('/api/shuttle-templates/:id/only', async (request, response) => {
  try {
    const existing = await prisma.shuttleTemplate.findUnique({ where: { id: request.params.id } })
    if (!existing) {
      response.status(404).json({ code: 'SHUTTLE_TEMPLATE_NOT_FOUND', msg: 'Shuttle template was not found', type: 'error' })
      return
    }

    const updated = await prisma.$transaction(async transaction => {
      await transaction.shuttleTemplate.updateMany({
        data: { enabled: false },
        where: { situation: existing.situation }
      })
      return await transaction.shuttleTemplate.update({
        data: { enabled: true },
        where: { id: existing.id }
      })
    })
    response.json(updated)
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.patch('/api/shuttle-templates/:id', async (request, response) => {
  const parsed = shuttleTemplatePatch.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_SHUTTLE_TEMPLATE', msg: parsed.error.message, type: 'error' })
    return
  }

  try {
    const existing = await prisma.shuttleTemplate.findUnique({ where: { id: request.params.id } })
    if (!existing) {
      response.status(404).json({ code: 'SHUTTLE_TEMPLATE_NOT_FOUND', msg: 'Shuttle template was not found', type: 'error' })
      return
    }
    if (existing.enabled && parsed.data.enabled === false) {
      const enabledCount = await prisma.shuttleTemplate.count({
        where: { enabled: true, situation: existing.situation }
      })
      if (enabledCount <= 1) {
        response.status(409).json({ code: 'ALL_SHUTTLE_TEMPLATES_DISABLED', msg: 'At least one Shuttle template must remain enabled', type: 'error' })
        return
      }
    }

    const updated = await prisma.shuttleTemplate.update({
      data: {
        ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.situation === undefined ? {} : { situation: parsed.data.situation }),
        ...(parsed.data.template === undefined ? {} : { template: parsed.data.template })
      },
      where: { id: existing.id }
    })
    response.json(updated)
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
})

app.delete('/api/shuttle-templates/:id', async (request, response) => {
  try {
    const existing = await prisma.shuttleTemplate.findUnique({ where: { id: request.params.id } })
    if (!existing) {
      response.status(404).json({ code: 'SHUTTLE_TEMPLATE_NOT_FOUND', msg: 'Shuttle template was not found', type: 'error' })
      return
    }
    await prisma.shuttleTemplate.delete({ where: { id: existing.id } })
    response.status(204).end()
  } catch (error) {
    logger.error(error)
    response.status(500).json({ code: 'DATABASE_FAILED', msg: String(error), type: 'error' })
  }
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

const scanUnitPatch = z.object({
  chestnyZnakCode: z.string().min(1).nullable().optional(),
  productCodeId: z.string().min(1).optional()
})

app.patch('/api/scan-units/:id', async (request, response) => {
  const parsed = scanUnitPatch.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ code: 'INVALID_SCAN_UNIT', msg: parsed.error.message, type: 'error' })
    return
  }

  try {
    const scanUnit = await prisma.scanUnit.findUnique({ where: { id: request.params.id } })
    if (!scanUnit) {
      response.status(404).json({ code: 'SCAN_UNIT_NOT_FOUND', msg: 'ScanUnit was not found', type: 'error' })
      return
    }

    if (parsed.data.productCodeId !== undefined) {
      const productCode = await prisma.productCode.findUnique({ where: { id: parsed.data.productCodeId } })
      if (!productCode) {
        response.status(404).json({ code: 'PRODUCT_CODE_NOT_FOUND', msg: 'ProductCode was not found', type: 'error' })
        return
      }
    }

    const updated = await prisma.scanUnit.update({
      data: {
        ...(parsed.data.chestnyZnakCode !== undefined && {
          chestnyZnakCode: parsed.data.chestnyZnakCode === null
            ? null
            : escapeSpecialCharacters(parsed.data.chestnyZnakCode)
        }),
        ...(parsed.data.productCodeId !== undefined && { productCodeId: parsed.data.productCodeId })
      },
      include: { productCode: { include: { product: true } } },
      where: { id: request.params.id }
    })
    response.json(updated)
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

app.post('/api/scan-units/:id/crpt-data', async (request, response) => {
  try {
    const scanUnit = await prisma.scanUnit.findUnique({ where: { id: request.params.id } })
    if (!scanUnit) {
      response.status(404).json({ code: 'SCAN_UNIT_NOT_FOUND', msg: 'ScanUnit was not found', type: 'error' })
      return
    }
    const chestnyZnakCode = scanUnit.chestnyZnakCode
    if (!chestnyZnakCode) {
      response.status(400).json({ code: 'CHESTNY_ZNAK_NOT_FOUND', msg: 'ScanUnit has no Chestny Znak code', type: 'error' })
      return
    }

    const crptData = await crptAPI.checkDataMatrix(chestnyZnakCode)
    const updated = await prisma.scanUnit.update({
      data: { chestnyZnakData: JSON.parse(JSON.stringify(crptData)) as never },
      include: { productCode: { include: { product: true } } },
      where: { id: scanUnit.id }
    })
    response.json(updated)
  } catch (error) {
    logger.error(error)
    response.status(502).json({ code: 'CRPT_FAILED', msg: String(error), type: 'error' })
  }
})

app.get('/api/stats', async (_, response) => {
  try {
    response.json(await getScanStats(prisma))
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

async function readScanUnitForTemplate (id: string): Promise<ScanTemplateScanUnit | null> {
  const scanUnit = await prisma.scanUnit.findUnique({
    include: { productCode: { include: { product: true } } },
    where: { id }
  })
  return scanUnit ? serializeScanUnit(scanUnit) : null
}

function serializeScanUnit (scanUnit: {
  id: string
  productCodeId: string
  chestnyZnakCode: string | null
  chestnyZnakData: unknown
  createdAt: Date
  updatedAt: Date
  productCode: {
    id: string
    gtin: string
    productId: string | null
    crptData: unknown
    edadealData: unknown
    createdAt: Date
    updatedAt: Date
    product: {
      id: string
      brand: string
      name: string
      volume: Decimal
      caffeine: Decimal
      alcohol: Decimal
      createdAt: Date
      updatedAt: Date
    } | null
  }
}): ScanTemplateScanUnit {
  const product = scanUnit.productCode.product
  return {
    chestnyZnakCode: scanUnit.chestnyZnakCode,
    chestnyZnakData: scanUnit.chestnyZnakData,
    createdAt: scanUnit.createdAt.toISOString(),
    id: scanUnit.id,
    productCode: {
      createdAt: scanUnit.productCode.createdAt.toISOString(),
      crptData: scanUnit.productCode.crptData,
      edadealData: scanUnit.productCode.edadealData,
      gtin: scanUnit.productCode.gtin,
      id: scanUnit.productCode.id,
      product: product
        ? {
          alcohol: product.alcohol.toNumber(),
          brand: product.brand,
          caffeine: product.caffeine.toNumber(),
          createdAt: product.createdAt.toISOString(),
          id: product.id,
          name: product.name,
          updatedAt: product.updatedAt.toISOString(),
          volume: product.volume.toNumber()
        }
        : null,
      productId: scanUnit.productCode.productId,
      updatedAt: scanUnit.productCode.updatedAt.toISOString()
    },
    productCodeId: scanUnit.productCodeId,
    updatedAt: scanUnit.updatedAt.toISOString()
  }
}

// fn main() { // >:P
app.listen(environment.WEB_SERVER_PORT, () => {
  logger.info(`started web server on :${environment.WEB_SERVER_PORT}`)
})

await shuttleAdapter.start()
// }
