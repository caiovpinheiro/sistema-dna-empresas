import { loadEmpresaConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildEmpresaApp } from "./app.js";

const config = loadEmpresaConfig();
const db = createPool(config);
try {
  await db.query("alter table dna_work.usuario_empresa add column if not exists senha_hash text");
  await db.query("alter table dna_work.vaga add column if not exists cidade character varying");
  await db.query(`
    create table if not exists dna_work.cadastro_empresa_aceite (
      id uuid primary key,
      id_empresa varchar(40) not null references dna_work.empresa (id_empresa) on delete cascade,
      id_vaga varchar(40) references dna_work.vaga (id_vaga) on delete set null,
      id_usuario varchar(40),
      versao varchar(40) not null,
      modalidade varchar(20) not null,
      condicoes text not null,
      responsavel varchar(255) not null,
      cargo varchar(80) not null,
      email varchar(255) not null,
      ip varchar(64),
      comprovante varchar(32) not null unique,
      aceito_em timestamptz not null default now()
    )
  `);
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
