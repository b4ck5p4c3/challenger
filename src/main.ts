import { PrismaPg } from '@prisma/adapter-pg'
import { Decimal, type InputJsonObject } from '@prisma/client/runtime/client'
import cors from 'cors'
import express from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import z from 'zod'

import { CrptAPI } from './api/crpt'
import { EdadealAPI, EdadealNotFoundError } from './api/edadeal'
import { getEnvironment } from './environment'
import { type Item, PrismaClient } from './generated/prisma/client'
import { getLogger } from './logger'
import { FontSet, Shuttle, ShuttleClient, ShuttleServer, StringAlignment } from './shuttle'

const logger = getLogger()

const environment = getEnvironment()

const shuttleEndpoint = environment.SHUTTLE_CLIENT_HOST 
  ? new ShuttleClient(environment.SHUTTLE_CLIENT_HOST, environment.SHUTTLE_CLIENT_PORT)
  : new ShuttleServer(environment.SHUTTLE_SERVER_PORT)

const crptApi = new CrptAPI()
const edadealApi = new EdadealAPI()
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: environment.DATABASE_URL
  })
})

const EAN13_REGEX = /^(\d{13})$/

async function fetchCrptEanDataSafe (ean: string): Promise<undefined | unknown> {
  try {
    return await crptApi.checkEan(ean)
  } catch (error) {
    logger.warn(error)
    return undefined
  }
}

async function fetchEdadealDataSafe (code: string): Promise<undefined | unknown> {
  try {
    return await edadealApi.search(code)
  } catch (error) {
    if (error instanceof EdadealNotFoundError) {
      return undefined
    }
    logger.warn(error)
    return undefined
  }
}

async function parseInput (code: string): Promise<null | {
  crptEanData?: unknown,
  crptLabelData?: unknown,
  crptLabelId?: string,
  ean13: string;
  edadealData?: unknown
}> {
  if (EAN13_REGEX.test(code)) {
    return { crptEanData: await fetchCrptEanDataSafe(code), ean13: code, edadealData: await fetchEdadealDataSafe(code) }
  }
  try {
    const result = await crptApi.checkDataMatrix(code)
    if (!result.codeFounded) {
      return null
    }
    return {
      crptEanData: await fetchCrptEanDataSafe(result.gtin.slice(1)),
      crptLabelData: result,
      crptLabelId: result.serial,
      ean13: result.gtin.slice(1),
      edadealData: await fetchEdadealDataSafe(result.gtin.slice(1)),
    }
  } catch (error) {
    logger.warn(error)
    return null
  }
}

async function processScan (shuttle: Shuttle, data: Buffer) {
  await shuttle.sendEnableScanning(false)
  await shuttle.sendClearDisplayAndMoveToTopLeft()
  await shuttle.sendPrintAlignedString(StringAlignment.CENTER_CENTER, 'Processing...')

  try {
    const code = data.toString('ascii')

    const inputParseResult = await parseInput(code)
    if (!inputParseResult) {
      await shuttle.sendClearDisplayAndMoveToTopLeft()
      await shuttle.sendSelectFontSet(FontSet.LARGE)
      await shuttle.sendPrintAlignedString(StringAlignment.CENTER_CENTER, 'WTF is it?')
      return
    }

    const { crptEanData, crptLabelData, crptLabelId, ean13, edadealData } = inputParseResult

    let item = await prisma.item.findFirst({ where: { ean13 } })
    if (!item) {
      item = await prisma.item.create({
        data: {
          alcohol: new Decimal(0),
          brand: '???',
          caffeine: new Decimal(0),
          crptEanData: (crptEanData ?? null) as InputJsonObject,
          ean13,
          edadealData: (edadealData ?? null) as InputJsonObject,
          name: '???',
          volume: new Decimal(0)
        }
      })

      const result = await doAiMagic(item)
      item = await prisma.item.update({
        data: {
          ...(result.brand !== undefined && { brand: result.brand }),
          ...(result.name !== undefined && { name: result.name }),
          ...(result.volume !== undefined && { volume: new Decimal(result.volume) }),
        },
        where: {
          id: item.id
        }
      })
    }

    if (crptLabelId && await prisma.scannedItem.findFirst({ where: { crptLabelId } })) {
      await shuttle.sendClearDisplayAndMoveToTopLeft()
      await shuttle.sendSelectFontSet(FontSet.LARGE)
      await shuttle.sendPrintAlignedString(StringAlignment.CENTER_CENTER, 'Already added!')
      return
    }

    await prisma.scannedItem.create({
      data: {
        crptLabelData: (crptLabelData ?? null) as InputJsonObject,
        crptLabelId: crptLabelId ?? null,
        itemId: item.id
      }
    })

    if (!item.filled) {
      await shuttle.sendClearDisplayAndMoveToTopLeft()
      await shuttle.sendSelectFontSet(FontSet.LARGE)
      await shuttle.sendSetPixelPosition(0, 0)
      await shuttle.sendPrintAlignedString(StringAlignment.CENTER_WITH_CURRENT_Y, item.brand)
      await shuttle.sendSelectFontSet(FontSet.NORMAL)
      await shuttle.sendSetPixelPosition(0, 20)
      await shuttle.sendPrintAlignedString(StringAlignment.CENTER_WITH_CURRENT_Y, item.name)
      await shuttle.sendSetPixelPosition(0, 32)
      await shuttle.sendPrintAlignedString(StringAlignment.CENTER_WITH_CURRENT_Y, `${item.volume}ml`)
      await shuttle.sendPrintAlignedString(StringAlignment.CENTER_BOTTOM, '! Unknown, please fill !')
      return
    }

    await shuttle.sendClearDisplayAndMoveToTopLeft()
    await shuttle.sendSelectFontSet(FontSet.LARGE)
    await shuttle.sendSetPixelPosition(0, 0)
    await shuttle.sendPrintAlignedString(StringAlignment.CENTER_WITH_CURRENT_Y, item.brand)
    await shuttle.sendSelectFontSet(FontSet.NORMAL)
    await shuttle.sendSetPixelPosition(0, 20)
    await shuttle.sendPrintAlignedString(StringAlignment.CENTER_WITH_CURRENT_Y, item.name)
    await shuttle.sendSetPixelPosition(0, 32)
    await shuttle.sendPrintAlignedString(StringAlignment.CENTER_WITH_CURRENT_Y, item.volume + 'ml / ' + item.caffeine + 'mg')
    await shuttle.sendPrintAlignedString(StringAlignment.RIGHT_BOTTOM, 'Saved')
  } catch (error) {
    logger.error(error)
  } finally {
    await shuttle.sendEnableScanning(true)
  }
}

shuttleEndpoint.on('connection', shuttle => {
  shuttle.on('scan', data => {
    processScan(shuttle, data).catch(error => logger.error(`failed to process scan: ${error}`))
  })
})

const app = express()

app.use(cors())
app.use(express.json())
app.use('/', express.static(path.join(process.cwd(), 'public')))

app.get('/api/items', (_, response) => {
  prisma.item.findMany({
    orderBy: {
      ean13: 'asc'
    }
  })
    .then(result => response.json(result.map(item => ({
      alcohol: item.alcohol.toNumber(),
      brand: item.brand,
      caffeine: item.caffeine.toNumber(),
      crptEanData: item.crptEanData,
      ean13: item.ean13,
      edadealData: item.edadealData,
      filled: item.filled,
      id: item.id,
      name: item.name,
      volume: item.volume.toNumber()
    }))))
    .catch(error => {
      logger.error(error)
      response.status(500).json({})
    })
})

app.get('/api/items/:id', (request, response) => {
  prisma.item.findFirst({
    where: {
      id: request.params.id
    }
  })
    .then(item => {
      if (item) {
        response.json({
          alcohol: item.alcohol.toNumber(),
          brand: item.brand,
          caffeine: item.caffeine.toNumber(),
          crptEanData: item.crptEanData,
          ean13: item.ean13,
          edadealData: item.edadealData,
          filled: item.filled,
          id: item.id,
          name: item.name,
          volume: item.volume.toNumber()
        })
      } else {
        response.status(400).json({})
      }
    })
    .catch(error => {
      logger.error(error)
      response.status(500).json({})
    })
})

app.get('/api/history', (request, response) => {
  const page = Math.max(1, Number.parseInt(String(request.query['page'] ?? '1')))
  Promise.all([prisma.scannedItem.findMany({
    include: {
      item: true
    },
    orderBy: {
      createdAt: 'desc'
    },
    skip: (page - 1) * 50,
    take: 50
  }), prisma.scannedItem.count()])
    .then(([result, total]) => response.json({
      scannedItems: result.map(item => ({
        createdAt: item.createdAt.toISOString(),
        crptLabelData: item.crptLabelData,
        crptLabelId: item.crptLabelId,
        id: item.id,
        item: {
          alcohol: item.item.alcohol.toNumber(),
          brand: item.item.brand,
          caffeine: item.item.caffeine.toNumber(),
          crptEanData: item.item.crptEanData,
          ean13: item.item.ean13,
          edadealData: item.item.edadealData,
          filled: item.item.filled,
          id: item.item.id,
          name: item.item.name,
          volume: item.item.volume.toNumber()
        }
      })),
      total
    }))
    .catch(error => {
      logger.error(error)
      response.status(500).json({})
    })
})

export interface Stats {
  alcohol: number
  caffeine: number
  volume: number
}

async function calculateStats (type: 'day' | 'month' | 'total'): Promise<Stats> {
  const now = new Date()

  let results: {
    alcohol: string,
    caffeine: string
    volume: string,
  }[]

  switch (type) {
    case 'day': {
      results = await prisma.$queryRaw`SELECT 
        sum(volume) as "volume", 
        sum(alcohol) as "alcohol", 
        sum(caffeine) as "caffeine"
        FROM scanned_items
        LEFT JOIN items ON scanned_items."itemId" = items.id
        WHERE filled AND scanned_items."createdAt" >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}`
      break
    }
    case 'month': {
      results = await prisma.$queryRaw`SELECT 
        sum(volume) as "volume", 
        sum(alcohol) as "alcohol", 
        sum(caffeine) as "caffeine"
        FROM scanned_items
        LEFT JOIN items ON scanned_items."itemId" = items.id
        WHERE filled AND scanned_items."createdAt" >= ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)}`
      break
    }
    case 'total': {
      results = await prisma.$queryRaw`SELECT 
        sum(volume) as "volume", 
        sum(alcohol) as "alcohol", 
        sum(caffeine) as "caffeine"
        FROM scanned_items
        LEFT JOIN items ON scanned_items."itemId" = items.id
        WHERE filled`
      break
    }
  }

  const result = results[0]
  if (!result) {
    throw new Error('WTF')
  }

  return {
    alcohol: Number.parseFloat(result.alcohol),
    caffeine: Number.parseFloat(result.caffeine),
    volume: Number.parseFloat(result.volume)
  }
}

app.get('/api/stats', async (_, response) => {
  Promise.all([calculateStats('day'), calculateStats('month'), calculateStats('total')])
    .then(stats => {
      const [day, month, total] = stats
      response.json({
        day,
        month,
        total
      })
    })
})

const itemsPatchRequest = z.object({
  alcohol: z.number().optional(),
  brand: z.string().optional(),
  caffeine: z.number().optional(),
  filled: z.boolean(),
  name: z.string().optional(),
  volume: z.number().optional()
})

app.patch('/api/items/:id', (request, response) => {
  const data = itemsPatchRequest.parse(request.body)
  const id = request.params.id

  prisma.item.update({
    data: {
      ...(data.alcohol !== undefined && { alcohol: new Decimal(data.alcohol) }),
      ...(data.brand !== undefined && { brand: data.brand }),
      ...(data.caffeine !== undefined && { caffeine: new Decimal(data.caffeine) }),
      ...(data.filled !== undefined && { filled: data.filled }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.volume !== undefined && { volume: new Decimal(data.volume) }),
    },
    where: {
      id
    }
  })
    .then(() => response.json({}))
    .catch(error => {
      logger.error(error)
      response.status(500).json({})
    })
})

const aiResponseSchema = z.object({
  alcohol: z.number().optional(),
  alcoholPercent: z.number().optional(),
  brand: z.string().optional(),
  caffeine: z.number().optional(),
  caffeineConcentration: z.number().optional(),
  name: z.string().optional(),
  volume: z.number().optional()
})

const client = new OpenAI({
  apiKey: environment.OPENAI_API_KEY,
  baseURL: environment.OPENAI_BASE_URL
})

const systemPrompt = readFileSync('magic-system-prompt.txt').toString('utf8')

type AiResponse = z.infer<typeof aiResponseSchema>

async function doAiMagic (item: Item): Promise<AiResponse> {
  const completion = await client.chat.completions.create({
    messages: [{
      content: systemPrompt,
      role: 'system'
    }, {
      content: JSON.stringify({
        crpt: item.crptEanData,
        edadeal: item.edadealData
      }),
      role: 'user'
    }],
    model: environment.OPENAI_MODEL
  })

  const content = completion.choices[0]?.message.content
  logger.info(content)
  if (!content) {
    return {}
  }
  try {
    const jsonData = JSON.parse(content)
    return aiResponseSchema.parse(jsonData)
  } catch (error) {
    logger.warn(error)
    return {}
  }
}

app.post('/api/items/:id/ai', (request, response) => {
  const id = request.params.id

  prisma.item.findFirst({
    where: {
      id
    }
  }).then(item => {
    if (!item) {
      response.status(404).json({})
      return
    }
    return doAiMagic(item)
  }).then(result => {
    response.json(result)
  }).catch(error => {
    logger.error(error)
    response.status(500).json({})
  })
})

app.listen(environment.WEB_SERVER_PORT, (error) => {
  if (error) {
    logger.fatal(`failed to start web server on :${environment.WEB_SERVER_PORT}`, error)
    process.exit(1)
  }

  logger.info(`started web server on :${environment.WEB_SERVER_PORT}`)
})

try {
  await shuttleEndpoint.start()
} catch (error) {
  logger.fatal(`failed to start shuttle`, error)
  process.exit(1)
}
