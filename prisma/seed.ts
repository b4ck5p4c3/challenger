import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

import { scanSituations, type ScanSituation } from '../src/domain/scanning'
import { PrismaClient } from '../src/generated/prisma/client'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

const templates: Record<ScanSituation, { name: string; template: string }> = {
  processing: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
Processing...<CR>
Please wait`
  },
  ean_registered: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
{{#if scanUnit.productCode.product}}Brnd: <ALIGN:RCY>{{scanUnit.productCode.product.brand}}</ALIGN><CR>
Name: <ALIGN:RCY>{{scanUnit.productCode.product.name}}</ALIGN><CR>
{{else}}
EAN not assigned with<CR>
any existing ITEM!<CR>
{{/if}}<CR>
Scan DataMatrix!<CR>`
  },
  chestny_znak_paired: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
DataMatrix paired!<CR>
<CR>
Item replaced<CR><SLEEP:200><BEEP>`
  },
  chestny_znak_registered: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
{{#if scanUnit.productCode.product}}Brnd: <ALIGN:RCY>{{scanUnit.productCode.product.brand}}</ALIGN><CR>
Name: <ALIGN:RCY>{{scanUnit.productCode.product.name}}</ALIGN><CR>
{{else}}
DataMatrix not assigned<CR>
with any existing ITEM!<CR>
{{/if}}`
  },
  duplicate_chestny_znak: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
Oh! It's already in<CR>
<ALIGN:RCY>DataBase!</ALIGN><CR>
<CR>
Scan next item<SLEEP:200><BEEP>`
  },
  unsupported: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
<CR>
<ALIGN:CCY>Unsupported code</ALIGN><CR>
<ALIGN:RCY>Scan EAN13 or</ALIGN><CR>
<ALIGN:RCY>DataMatrix</ALIGN>

<SLEEP:200><BEEP><SLEEP:200><BEEP>`
  },
  error: {
    name: 'default',
    template: `<CLEAR><FONT:NORM>
Scan failed<CR>
{{#if result.code}}
<ALIGN:LCY>{{result.code}}</ALIGN><CR>
{{/if}}
Please retry<SLEEP:200><BEEP><SLEEP:200><BEEP>`
  }
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed SCML templates')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })

try {
  const created = await prisma.$transaction(async transaction => {
    let count = 0
    for (const situation of scanSituations) {
      const existing = await transaction.shuttleTemplate.findFirst({
        select: { id: true },
        where: { situation }
      })
      if (existing) continue

      await transaction.shuttleTemplate.create({
        data: {
          ...templates[situation],
          enabled: true,
          situation
        }
      })
      count += 1
    }
    return count
  })
  console.log(`Created ${created} SCML templates; skipped ${scanSituations.length - created} existing situations`)
} finally {
  await prisma.$disconnect()
}
