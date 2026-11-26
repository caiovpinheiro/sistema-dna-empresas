import { loadEmpresaConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildEmpresaApp } from "./app.js";

const config = loadEmpresaConfig();
const db = createPool(config);
try {
  await db.query("alter table dna_work.usuario_empresa add column if not exists senha_hash text");
  await db.query("alter table dna_work.vaga add column if not exists cidade character varying");
  // Feriado que repete todo ano (fixo) e ponto facultativo, que não conta como feriado no cálculo do ponto.
  await db.query("alter table dna_work.feriados add column if not exists fixo smallint not null default 0");
  await db.query("alter table dna_work.feriados add column if not exists facultativo smallint not null default 0");
  // Jornada = escala com o horário de cada dia: a carga (ponto_carga_base) de cada dia de trabalho fica na própria escala.
  for (const dia of ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"]) {
    await db.query(`alter table dna_work.ponto_turno_base add column if not exists ${dia}_carga integer`);
  }
  // Modalidade da jornada (1 estágio, 2 CLT): define os limites da lei e quem pode usá-la. Escalas antigas ficam sem.
  await db.query("alter table dna_work.ponto_turno_base add column if not exists modalidade smallint");
  // Último dia de trabalho de quem foi desligado ("YYYY/MM/DD", como as outras datas do legado): depois dele não há falta.
  await db.query("alter table dna_work.colaborador add column if not exists data_desligamento character varying");
  // Senha do app do ponto em Argon2id (com salt), como a do portal da empresa.
  await db.query("alter table dna_work.candidato add column if not exists senha_hash character varying");
  // Permissões que a empresa dá a um colaborador para cuidar do ponto de outros, pelo app do ponto (o login da empresa
  // é um só). id_gestor = id_candidato de quem recebe; sem linha, o colaborador só vê o próprio ponto.
  await db.query(`
    create table if not exists dna_work.ponto_permissao_gestor (
      id_gestor character varying not null,
      id_empresa character varying not null,
      permissao character varying(20) not null,
      todos boolean not null default false,
      primary key (id_gestor, id_empresa, permissao)
    )
  `);
  await db.query(`
    create table if not exists dna_work.ponto_permissao_gestor_pessoa (
      id_gestor character varying not null,
      id_empresa character varying not null,
      permissao character varying(20) not null,
      id_candidato character varying not null,
      primary key (id_gestor, id_empresa, permissao, id_candidato)
    )
  `);
  // Almoço livre: a pessoa escolhe a hora de sair, a jornada só fixa quanto tempo dura (em minutos).
  await db.query("alter table dna_work.ponto_carga_base add column if not exists refeicao_livre smallint not null default 0");
  await db.query("alter table dna_work.ponto_carga_base add column if not exists refeicao_minutos integer");
  // Pedido do colaborador para incluir uma marcação que ele esqueceu (entrada, saída ou o dia inteiro). Aprovado, vira
  // uma linha em tabela_ponto só com os campos *_editado: fica identificada como incluída, sem horário do relógio.
  await db.query(`
    create table if not exists dna_work.ponto_inclusao (
      id serial primary key,
      id_colaborador character varying not null,
      data character varying(10) not null,
      entrada character varying(5) not null,
      saida character varying(5),
      motivo character varying(255) not null,
      aceite smallint,
      resposta character varying(255),
      id_ponto integer,
      id_usuario character varying,
      criado_em timestamptz not null default now(),
      respondido_em timestamptz
    )
  `);
  await db.query("create index if not exists ponto_inclusao_colaborador on dna_work.ponto_inclusao (id_colaborador)");
  // Histórico da jornada de cada pessoa: mudar a jornada vale de hoje em diante e não muda o espelho dos dias passados.
  // dias = { segunda: { trabalha, carga }, ... } com o horário copiado (a carga original pode ser apagada depois).
  await db.query(`
    create table if not exists dna_work.ponto_jornada_historico (
      id serial primary key,
      id_colaborador character varying not null,
      desde character varying(10) not null,
      dias jsonb not null,
      criado_em timestamptz not null default now(),
      unique (id_colaborador, desde)
    )
  `);
  // Sessões encerradas antes de vencer (botão Sair): o token fica inválido até a hora em que venceria.
  await db.query(`
    create table if not exists dna_work.portal_sessao_revogada (
      jti character varying(64) primary key,
      expira timestamptz not null
    )
  `);
  await db.query("delete from dna_work.portal_sessao_revogada where expira < now()");
  // Pedido respondido por um colaborador com permissão (pelo app do ponto): guarda quem foi, além do login da empresa.
  await db.query("alter table dna_work.ponto_inclusao add column if not exists id_gestor character varying");
  await db.query("alter table dna_work.justificativa add column if not exists id_gestor character varying");
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
