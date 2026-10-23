import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: path.resolve(process.cwd(), ".env") });
loadDotenv({ path: path.resolve(process.cwd(), "../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGIN: z.string().default("http://localhost:5174"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  INTERNO_API_URL: z.string().optional().default(""),
  SERVICE_TOKEN: z.string().optional().default(""),
});

export type EmpresaConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
};

export function loadEmpresaConfig(): EmpresaConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Variáveis de ambiente inválidas: ${fields}`);
  }
  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean),
  };
}
