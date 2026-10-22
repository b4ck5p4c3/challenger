import Handlebars from 'handlebars'

import { getLogger } from '../logger'
import type { PrismaClient } from '../generated/prisma/client'
import type { ScanTemplateContext } from '../domain/scanning'
import { compileScml, executeScml } from './scml'
import type { Shuttle } from './protocol'

const handlebars = Handlebars.create()

// Handlebars normally escapes for HTML. Shuttle needs SCML-safe text instead.
const handlebarsUtils = handlebars.Utils as unknown as {
  escapeExpression: (value: unknown) => string
}
handlebarsUtils.escapeExpression = value => escapeScmlText(formatValue(value))

export class ShuttleTemplateRenderer {
  private readonly logger = getLogger<ShuttleTemplateRenderer>()

  constructor (private readonly prisma: PrismaClient) {}

  async send (shuttle: Shuttle, context: ScanTemplateContext): Promise<void> {
    try {
      const templates = await this.prisma.shuttleTemplate.findMany({
        orderBy: { createdAt: 'asc' },
        where: {
          enabled: true,
          situation: context.situation
        }
      })
      const template = templates[Math.floor(Math.random() * templates.length)]
      if (!template) return

      const source = renderTemplate(template.template, context)
      await executeScml(compileScml(source), shuttle)
    } catch (error) {
      this.logger.error(`failed to render Shuttle template for ${context.situation}:`, error)
    }
  }
}

export function renderTemplate (source: string, context: ScanTemplateContext): string {
  return handlebars.compile(source)(context)
}

function formatValue (value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value) ?? ''
}

function escapeScmlText (value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('<', '\\<').replaceAll('>', '\\>')
}
