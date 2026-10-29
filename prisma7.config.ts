import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    url: process.env['DATABASE_URL']!,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  schema: 'prisma/schema.prisma',
})
