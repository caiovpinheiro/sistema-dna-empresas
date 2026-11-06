import { loadEmpresaConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildEmpresaApp } from "./app.js";

const config = loadEmpresaConfig();
const db = createPool(config);
try {
  await db.query("alter table dna_work.usuario_empresa add column if not exists senha_hash text");
  await db.query("alter table dna_work.vaga add column if not exists cidade character varying");
  await db.query(`
    update dna_work.vaga v
    set cidade = e.cidade
    from dna_work.empresa e
    where e.id_empresa = v.id_empresa
      and (v.cidade is null or btrim(v.cidade) = '')
      and nullif(btrim(e.cidade), '') is not null
  `);
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code !== "42P01") throw error;
  console.warn("Tabela do portal ainda não existe nesta base.");
}
const app = await buildEmpresaApp(config, db);
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : config.HOST;
await app.listen({ port: config.PORT, host });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
