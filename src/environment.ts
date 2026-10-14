import { config } from 'dotenv'
import z from 'zod'

config({
  path: '.env.local'
})
config()

const environment = z.object({
  DATABASE_URL: z.url(),

  SHUTTLE_CLIENT_HOST: z.string().optional(), // IF DEFINED MODE == CLIENT
  SHUTTLE_CLIENT_PORT: z.coerce.number().default(1337),
  SHUTTLE_SERVER_PORT: z.coerce.number().default(1337),

  WEB_SERVER_PORT: z.coerce.number(),
  FRONTEND_DIR: z.string().min(1).default('public')
})

export type Environment = z.infer<typeof environment>

export function getEnvironment (): Environment {
  return environment.parse(process.env)
}
