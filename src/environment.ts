import { config } from 'dotenv'
import z from 'zod'

config({
  path: '.env.local'
})
config()

const environment = z.object({
  DATABASE_URL: z.url(),

  OPENAI_API_KEY: z.string(),
  OPENAI_BASE_URL: z.url(),
  OPENAI_MODEL: z.string(),

  SHUTTLE_CLIENT_HOST: z.string().optional(), // IF DEFINED MODE == CLIENT
  SHUTTLE_CLIENT_PORT: z.coerce.number().default(1337),
  SHUTTLE_SERVER_PORT: z.coerce.number().default(1337),

  WEB_SERVER_PORT: z.coerce.number()
})

export type Environment = z.infer<typeof environment>

export function getEnvironment (): Environment {
  return environment.parse(process.env)
}
