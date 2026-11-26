import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Consulta = Pick<Pool, "query"> | PoolClient;
import { AppError } from "../lib/errors.js";
import { dataIsoValida, proximoId } from "../lib/validacao.js";
import { SENHA_MINIMA, gravarSenha, guardarHash, senhaConfere } from "../lib/senha-colaborador.js";

export type SessaoPonto = {
  nome: string;
  empresa: string;
  acao: "entrada" | "saida" | "bloqueado";
  motivo: string | null;
  /** Senha provisória (gerada pelo interno ou redefinida): a pessoa troca antes de usar o app. */
  trocarSenha: boolean;
  /** Dias anteriores com entrada e sem saída, ainda sem pedido: o app avisa para pedir o ajuste. */
  saidasPendentes: Array<{ id: number; data: string; entrada: string }>;
  registros: RegistroPonto[];
};

/**
 * Pedido do colaborador. "ajuste" corrige o horário de uma batida (tabela antiga "justificativa", que o interno
 * também lê); "inclusao" pede um período esquecido inteiro (tabela ponto_inclusao).
 */
export type Solicitacao = {
  chave: string;
  origem: "ajuste" | "inclusao";
  dataIso: string;
  data: string;
  titulo: string;
  detalhe: string;
  motivo: string;
  situacao: "Pendente" | "Aprovada" | "Recusada";
  resposta: string | null;
};

/** Horário que vale de cada lado da batida: o corrigido (aprovado pela empresa) ou o do relógio. */
const ENTRADA = "coalesce(nullif(btrim(t.entrada_editado), ''), t.entrada)";
const SAIDA = "coalesce(nullif(btrim(t.saida_editado), ''), t.saida)";

/** Segundos do dia de "HH:MM" ou "HH:MM:SS". */
function noDia(hora: string) {
  const [h, m, s] = hora.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

/** Mais longo que isso, um período que passa da meia-noite é quase sempre saída digitada antes da entrada. */
const MAXIMO_VIRANDO_A_NOITE = 12 * 3600;
/** Nenhuma marcação contínua (entrada até a saída) passa disso. */
const MAXIMO_DO_PERIODO = 16 * 3600;

/**
 * Confere um par entrada/saída. Saída menor que a entrada = passou da meia-noite, o que só é aceito até 12 horas
 * (ex.: 22:00 às 06:00). Assim "entrada 16:10, saída 07:00" não vira 15 horas de trabalho.
 */
export function conferirPar(entrada: string | null, saida: string | null, campo: "entrada" | "saida" | "hora" = "saida") {
  if (!entrada || !saida) return;
  const inicio = noDia(entrada);
  const fim = noDia(saida);
  const virou = fim <= inicio;
  const duracao = virou ? fim + 86_400 - inicio : fim - inicio;
  if (virou && duracao > MAXIMO_VIRANDO_A_NOITE) {
    const mensagem = "A saída ficou antes da entrada. Confira os horários (um período que passa da meia-noite pode ter no máximo 12 horas).";
    throw new AppError(422, "SAIDA_ANTES_DA_ENTRADA", mensagem, { [campo]: "Saída antes da entrada." });
  }
  if (duracao > MAXIMO_DO_PERIODO) {
    throw new AppError(422, "PERIODO_LONGO", "Um período de trabalho sem saída não pode passar de 16 horas. Confira os horários.", { [campo]: "Período longo demais." });
  }
}

/** "YYYY/MM/DD" somado de n dias. */
function outroDia(data: string, dias: number) {
  const [a, m, d] = data.split("/").map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d + dias));
  return `${dia.getUTCFullYear()}/${String(dia.getUTCMonth() + 1).padStart(2, "0")}/${String(dia.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Recusa um período que se sobrepõe a uma batida ou a uma inclusão pendente. Olha também o dia anterior e o
 * seguinte, porque um período que passa da meia-noite entra no outro dia. Saída menor que a entrada = passou da
 * meia-noite. `ignorarPonto`: a própria batida que está sendo ajustada.
 */
export async function conferirSobreposicao(db: { query: PoolClient["query"] }, idColaborador: string, data: string, entrada: string, saida: string, ignorarPonto: number | null = null) {
  const ontem = outroDia(data, -1);
  const amanha = outroDia(data, 1);
  const deslocamento = (dia: string) => (dia === ontem ? -86_400 : dia === amanha ? 86_400 : 0);
  const intervalo = (dia: string, de: string, ate: string | null) => {
    const inicio = noDia(de) + deslocamento(dia);
    if (!ate) return [inicio, inicio] as const;
    const fim = noDia(ate) + deslocamento(dia);
    return [inicio, fim > inicio ? fim : fim + 86_400] as const;
  };
  const novo = intervalo(data, entrada, saida);
  const existentes = await db.query<{ data: string; entrada: string | null; saida: string | null; origem: string }>(`
    select t.data, ${ENTRADA} as entrada, ${SAIDA} as saida, 'batida' as origem
    from dna_work.tabela_ponto t
    where t.id_colaborador = $1 and t.data = any($2::text[]) and coalesce(t.excluido, 0) = 0 and ($3::int is null or t.id <> $3)
    union all
    select data, entrada, saida, 'pedido' from dna_work.ponto_inclusao where id_colaborador = $1 and data = any($2::text[]) and aceite is null
  `, [idColaborador, [ontem, data, amanha], ignorarPonto]);
  for (const linha of existentes.rows) {
    if (!linha.entrada) continue;
    const [inicio, fim] = intervalo(linha.data, linha.entrada, linha.saida);
    // Encostar (uma termina às 12:00 e a outra começa às 12:00) não é sobrepor.
    if (novo[0] < fim && inicio < novo[1]) {
      const quando = `${linha.entrada.slice(0, 5)}${linha.saida ? ` às ${linha.saida.slice(0, 5)}` : ""}${linha.data === data ? "" : ` de ${linha.data.slice(8, 10)}/${linha.data.slice(5, 7)}`}`;
      throw new AppError(409, "SOBREPOSICAO", linha.origem === "pedido"
        ? `Já existe um pedido de inclusão nesse horário (${quando}) esperando a empresa.`
        : `Esse horário bate com uma marcação que já existe (${quando}). Para corrigir uma batida, use "Corrigir uma batida".`);
    }
  }
}

type RegistroPonto = {
  id: number;
  data: string;
  entrada: string | null;
  saida: string | null;
  nsrEntrada: number | null;
  nsrSaida: number | null;
};

type ColaboradorPonto = {
  id_colaborador: string;
  id_candidato: string;
  id_empresa: string;
  nome: string;
  empresa: string;
  cpf: string | null;
  atualiza_senha: number | null;
  /** Início do contrato, "AAAA/MM/DD". */
  inicio?: string | null;
};

type Batida = {
  id: number;
  data: string;
  entrada: string | null;
  saida: string | null;
  nsf_entrada: number | null;
  nsf_saida: number | null;
  id_carga: string | null;
};

const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;

export class PontoColaboradorService {
  constructor(private readonly db: Pool) {}

  async login(cpf: string, senha: string): Promise<ColaboradorPonto> {
    const digitos = cpf.replace(/\D/g, "");
    if (digitos.length < 11) throw new AppError(401, "LOGIN_INVALIDO", "CPF ou senha inválidos.");
    const encontrado = await this.db.query<ColaboradorPonto & { senha: string | null; senha_hash: string | null }>(`
      select col.id_colaborador, c.id_candidato, col.id_empresa, c.senha, c.senha_hash, c.cpf, c.atualiza_senha,
             case when c.usanomesocial::text = '1' then coalesce(nullif(c.nomesocial, ''), c.nome) else c.nome end as nome,
             coalesce(e.nome_fantasia, e.razao_social, 'Empresa') as empresa
      from dna_work.candidato c
      join dna_work.colaborador col on col.id_candidato = c.id_candidato and col.id_empresa = c.id_empresa
      join dna_work.empresa e on e.id_empresa = col.id_empresa
      where regexp_replace(coalesce(c.cpf, ''), '\\D', '', 'g') = $1
        and c.colaborador::text = '1'
        and col.status_ponto::text = '1'
        and coalesce(col.status_colaborador, 1) = 1
        and e.ponto::text = '1'
      order by col.data_inicio desc nulls last
      limit 1
    `, [digitos]);
    const pessoa = encontrado.rows[0];
    const conferida = pessoa ? await senhaConfere(pessoa, senha) : { ok: false, temHash: false };
    if (!pessoa || !conferida.ok) throw new AppError(401, "LOGIN_INVALIDO", "CPF ou senha inválidos.");
    // Ainda no MD5 (ou com o MD5 antigo guardado junto): passa para o Argon2id e apaga o MD5.
    if (!conferida.temHash || pessoa.senha) await guardarHash(this.db, pessoa.id_candidato, senha);
    return {
      id_colaborador: pessoa.id_colaborador,
      id_candidato: pessoa.id_candidato,
      id_empresa: pessoa.id_empresa,
      nome: pessoa.nome,
      empresa: pessoa.empresa,
      cpf: pessoa.cpf,
      atualiza_senha: pessoa.atualiza_senha,
    };
  }

  /** Marca curta da senha atual (vai no token): trocou a senha, as sessões abertas antes param de valer. */
  async marcaDaSenha(idColaborador: string): Promise<string> {
    const linha = await this.db.query<{ sv: string }>(`
      select left(md5(coalesce(c.senha_hash, '') || coalesce(c.senha, '')), 16) as sv
      from dna_work.colaborador col join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_colaborador = $1
    `, [idColaborador]);
    return linha.rows[0]?.sv ?? "";
  }

  /** Ainda pode usar o app: contrato ativo, no ponto e empresa com o ponto ligado. Conferido em toda chamada. */
  async acessoAtivo(idColaborador: string, marca?: string): Promise<boolean> {
    const linha = await this.db.query(`
      select 1 from dna_work.colaborador col
      join dna_work.empresa e on e.id_empresa = col.id_empresa
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_colaborador = $1 and coalesce(col.status_colaborador, 1) = 1
        and col.status_ponto::text = '1' and e.ponto::text = '1'
        and ($2::text is null or left(md5(coalesce(c.senha_hash, '') || coalesce(c.senha, '')), 16) = $2)
    `, [idColaborador, marca ?? null]);
    return Boolean(linha.rowCount);
  }

  async painel(idColaborador: string): Promise<SessaoPonto> {
    const pessoa = await this.pessoa(idColaborador);
    const agora = agoraSp();
    const bloqueio = await this.bloqueio(idColaborador, agora.legado);
    const registros = await this.registros(idColaborador);
    const trocarSenha = Number(pessoa.atualiza_senha) === 1;
    const saidasPendentes = await this.saidasPendentes(idColaborador, agora);
    const base = { nome: pessoa.nome, empresa: pessoa.empresa, trocarSenha, saidasPendentes, registros };
    if (bloqueio) return { ...base, acao: "bloqueado", motivo: bloqueio };
    const decisao = await this.decidir(idColaborador, agora);
    return { ...base, acao: decisao.tipo, motivo: null };
  }

  /**
   * Batidas de dias anteriores (últimos 60) que ficaram sem saída e ainda sem pedido de ajuste: o app avisa a pessoa.
   * O sistema não fecha sozinho: a saída só entra pelo pedido aprovado pela empresa.
   */
  private async saidasPendentes(idColaborador: string, agora: { iso: string; legado: string; hora: string }) {
    const ontem = diaAnteriorN(agora.iso, 1);
    const linhas = await this.db.query<{ id: number; data: string; entrada: string | null; id_carga: string | null }>(`
      select t.id, t.data, ${ENTRADA} as entrada, t.id_carga
      from dna_work.tabela_ponto t
      where t.id_colaborador = $1 and coalesce(t.excluido, 0) = 0 and t.data >= $2 and t.data < $3
        and coalesce(${SAIDA}, '') = '' and coalesce(${ENTRADA}, '') <> ''
        and not exists (select 1 from dna_work.justificativa j where j.id_ponto = t.id and j.tipo = 'saida' and coalesce(j.aceite, 1) = 1)
      order by t.data desc, ${ENTRADA} desc
    `, [idColaborador, diaAnteriorN(agora.iso, 60), agora.legado]);
    const pendentes: Array<{ id: number; data: string; entrada: string }> = [];
    for (const linha of linhas.rows) {
      // Turno da noite de ontem ainda pode fechar hoje de manhã (o app aceita a saída até o meio-dia).
      if (linha.data === ontem && agora.hora < "12:00:00" && (await this.noturno(linha.id_carga))) continue;
      pendentes.push({ id: linha.id, data: dataBr(linha.data), entrada: (linha.entrada ?? "").slice(0, 5) });
    }
    return pendentes;
  }

  /** Troca a senha do colaborador (a provisória do primeiro acesso ou a atual, quando ele quiser). */
  async trocarSenha(idColaborador: string, senhaAtual: string, senhaNova: string) {
    const pessoa = await this.pessoa(idColaborador);
    const atual = await this.db.query<{ senha: string | null; senha_hash: string | null }>("select senha, senha_hash from dna_work.candidato where id_candidato = $1", [pessoa.id_candidato]);
    if (!atual.rows[0] || !(await senhaConfere(atual.rows[0], senhaAtual)).ok) {
      throw new AppError(422, "SENHA_ATUAL_INVALIDA", "A senha atual não confere.", { senhaAtual: "A senha atual não confere." });
    }
    if (senhaNova.length < SENHA_MINIMA) throw new AppError(422, "SENHA_CURTA", "A senha precisa ter pelo menos 6 caracteres.", { senhaNova: "Use pelo menos 6 caracteres." });
    if (senhaNova === senhaAtual) throw new AppError(422, "SENHA_IGUAL", "A senha nova precisa ser diferente da atual.", { senhaNova: "Escolha uma senha diferente da atual." });
    await gravarSenha(this.db, pessoa.id_candidato, senhaNova, false);
    return { ok: true };
  }

  /**
   * Pedidos da pessoa (ajustes de batida e inclusões de marcação, os mais novos primeiro) e as batidas dos últimos
   * 60 dias, que ela pode pedir para ajustar.
   */
  async solicitacoes(idColaborador: string) {
    const pessoa = await this.pessoa(idColaborador);
    const ajustes = await this.db.query<{ id: number; data: string; tipo: string; hora: string | null; texto: string | null; aceite: number | null; resposta: string | null; entrada: string | null; saida: string | null }>(`
      select j.id, t.data, j.tipo, j.hora, j.texto, j.aceite, j.resposta, t.entrada, t.saida
      from dna_work.justificativa j
      join dna_work.tabela_ponto t on t.id = j.id_ponto
      where t.id_colaborador = $1 and j.tipo in ('entrada', 'saida')
      order by j.id desc
      limit 60
    `, [idColaborador]);
    const inclusoes = await this.db.query<{ id: number; data: string; entrada: string; saida: string | null; motivo: string; aceite: number | null; resposta: string | null }>(`
      select id, data, entrada, saida, motivo, aceite, resposta
      from dna_work.ponto_inclusao
      where id_colaborador = $1
      order by id desc
      limit 60
    `, [idColaborador]);
    const desde = diaAnteriorN(agoraSp().iso, 60);
    const batidas = await this.db.query<{ id: number; data: string; entrada: string | null; saida: string | null; pend_entrada: boolean; pend_saida: boolean }>(`
      select t.id, t.data, ${ENTRADA} as entrada, ${SAIDA} as saida,
             exists (select 1 from dna_work.justificativa j where j.id_ponto = t.id and j.tipo = 'entrada' and j.aceite is null) as pend_entrada,
             exists (select 1 from dna_work.justificativa j where j.id_ponto = t.id and j.tipo = 'saida' and j.aceite is null) as pend_saida
      from dna_work.tabela_ponto t
      where t.id_colaborador = $1 and coalesce(t.excluido, 0) = 0 and t.data >= $2
      order by t.data desc, ${ENTRADA} desc, t.id desc
    `, [idColaborador, desde]);
    const situacao = (aceite: number | null) => (aceite === 1 ? "Aprovada" : aceite === 0 ? "Recusada" : "Pendente") as Solicitacao["situacao"];
    const pedidos: Solicitacao[] = [
      ...ajustes.rows.map((linha): Solicitacao => ({
        chave: `ajuste-${linha.id}`,
        origem: "ajuste",
        dataIso: linha.data.replaceAll("/", "-"),
        data: dataBr(linha.data),
        titulo: `${linha.tipo === "saida" ? "Saída" : "Entrada"} às ${(linha.hora ?? "").slice(0, 5)}`,
        detalhe: `Registrado: ${((linha.tipo === "saida" ? linha.saida : linha.entrada) || "").slice(0, 5) || "nenhum horário"}`,
        motivo: linha.texto ?? "",
        situacao: situacao(linha.aceite),
        resposta: linha.resposta,
      })),
      ...inclusoes.rows.map((linha): Solicitacao => ({
        chave: `inclusao-${linha.id}`,
        origem: "inclusao",
        dataIso: linha.data.replaceAll("/", "-"),
        data: dataBr(linha.data),
        titulo: `Incluir ${linha.entrada} às ${linha.saida ?? "—"}`,
        detalhe: "Marcação esquecida",
        motivo: linha.motivo,
        situacao: situacao(linha.aceite),
        resposta: linha.resposta,
      })),
    ].sort((a, b) => (a.situacao === "Pendente" ? 0 : 1) - (b.situacao === "Pendente" ? 0 : 1) || b.dataIso.localeCompare(a.dataIso));
    return {
      pedidos,
      // Para a tela montar o espelho dos dias: de hoje até 60 dias atrás, sem passar do início do contrato.
      hoje: agoraSp().iso,
      desde: [desde.replaceAll("/", "-"), (pessoa.inicio ?? "").replaceAll("/", "-")].filter((valor) => /^\d{4}-\d{2}-\d{2}$/.test(valor)).sort().pop() ?? desde.replaceAll("/", "-"),
      batidas: batidas.rows.map((linha) => ({
        id: linha.id, data: dataBr(linha.data), dataIso: linha.data.replaceAll("/", "-"), entrada: linha.entrada, saida: linha.saida,
        pendenteEntrada: linha.pend_entrada, pendenteSaida: linha.pend_saida,
      })),
    };
  }

  /**
   * Pede a inclusão de um período esquecido (entrada e saída). A lei não deixa o sistema inventar marcação: ela só
   * entra se a empresa aprovar, e fica identificada como incluída (sem horário do relógio), com o motivo, quem
   * aprovou e quando (Portaria 671/2021, tratamento de ponto).
   */
  async incluir(idColaborador: string, body: { data: string; entrada: string; saida: string; motivo: string }) {
    const pessoa = await this.pessoa(idColaborador);
    const motivo = body.motivo.trim();
    const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
    const campos: Record<string, string> = {};
    const agora = agoraSp();
    const data = dataIsoValida(body.data)?.replaceAll("-", "/") ?? "";
    if (!data) campos.data = "Escolha o dia.";
    else if (data > agora.legado) campos.data = "O dia não pode ser no futuro.";
    else if (data < diaAnteriorN(agora.iso, 60)) campos.data = "Só dá para pedir nos últimos 60 dias. Fale com a empresa.";
    else if (pessoa.inicio && data < pessoa.inicio) campos.data = "Esse dia é antes do início do seu contrato.";
    if (!hora.test(body.entrada)) campos.entrada = "Informe a entrada.";
    if (!hora.test(body.saida)) campos.saida = "Informe a saída.";
    else if (body.saida === body.entrada) campos.saida = "A saída precisa ser diferente da entrada.";
    if (motivo.length < 5) campos.motivo = "Conte o motivo.";
    if (!campos.data && data === agora.legado && !campos.entrada && `${body.entrada}:00` > agora.hora) {
      campos.entrada = "A entrada não pode ser depois de agora.";
    } else if (!campos.data && data === agora.legado && !campos.saida && (body.saida < body.entrada || `${body.saida}:00` > agora.hora)) {
      campos.saida = "A saída não pode ser depois de agora.";
    }
    if (Object.keys(campos).length) throw new AppError(422, "VALIDACAO", Object.values(campos)[0], campos);
    conferirPar(body.entrada, body.saida);
    // Nas férias (ou com atestado do dia inteiro) não há trabalho para incluir, como já acontece com a batida.
    const bloqueio = await this.bloqueio(idColaborador, data);
    if (bloqueio) {
      const motivoBloqueio = bloqueio.includes("férias") ? "Esse dia está nas suas férias." : "Esse dia tem atestado médico.";
      throw new AppError(409, "DIA_BLOQUEADO", motivoBloqueio, { data: motivoBloqueio });
    }
    const client = await this.db.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inclusao-${idColaborador}`]);
      await conferirSobreposicao(client, idColaborador, data, body.entrada, body.saida);
      const novo = await client.query<{ id: number }>(
        "insert into dna_work.ponto_inclusao (id_colaborador, data, entrada, saida, motivo) values ($1,$2,$3,$4,$5) returning id",
        [idColaborador, data, body.entrada, body.saida, motivo.slice(0, 255)],
      );
      await client.query("commit");
      return { id: novo.rows[0].id };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Pede o ajuste de uma batida. A marcação original não muda (Portaria 671/2021): se a empresa aprovar, o horário
   * corrigido vai para entrada_editado/saida_editado, como o sistema antigo já faz.
   */
  async solicitar(idColaborador: string, body: { idPonto: number; tipo: "entrada" | "saida"; hora: string; motivo: string }) {
    await this.pessoa(idColaborador);
    const motivo = body.motivo.trim();
    const campos: Record<string, string> = {};
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.hora)) campos.hora = "Informe o horário certo.";
    if (motivo.length < 5) campos.motivo = "Conte o motivo do ajuste.";
    if (Object.keys(campos).length) throw new AppError(422, "VALIDACAO", Object.values(campos)[0], campos);
    const batida = await this.db.query<{ data: string; entrada: string | null; saida: string | null }>(`
      select data, coalesce(nullif(entrada_editado, ''), entrada) as entrada, coalesce(nullif(saida_editado, ''), saida) as saida
      from dna_work.tabela_ponto where id = $1 and id_colaborador = $2 and coalesce(excluido, 0) = 0
    `, [body.idPonto, idColaborador]);
    const linha = batida.rows[0];
    if (!linha) throw new AppError(404, "BATIDA_NAO_ENCONTRADA", "Batida não encontrada.");
    const agora = agoraSp();
    if (linha.data === agora.legado && `${body.hora}:00` > agora.hora) {
      throw new AppError(422, "HORA_FUTURA", "O horário não pode ser depois de agora.", { hora: "O horário não pode ser depois de agora." });
    }
    const atual = (body.tipo === "entrada" ? linha.entrada : linha.saida) ?? "";
    if (atual.slice(0, 5) === body.hora) {
      throw new AppError(422, "SEM_MUDANCA", "Esse já é o horário registrado.", { hora: "Esse já é o horário registrado." });
    }
    const novaEntrada = body.tipo === "entrada" ? body.hora : linha.entrada;
    const novaSaida = body.tipo === "saida" ? body.hora : linha.saida;
    conferirPar(novaEntrada, novaSaida, "hora");
    if (novaEntrada) await conferirSobreposicao(this.db, idColaborador, linha.data, novaEntrada.slice(0, 5), (novaSaida ?? novaEntrada).slice(0, 5), body.idPonto);
    const client = await this.db.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('justificativa'))");
      const pendente = await client.query("select 1 from dna_work.justificativa where id_ponto = $1 and tipo = $2 and aceite is null", [body.idPonto, body.tipo]);
      if (pendente.rowCount) throw new AppError(409, "JA_SOLICITADO", "Já existe um pedido para essa batida esperando a empresa.");
      const id = await proximoId(client, "justificativa");
      await client.query(
        "insert into dna_work.justificativa (id, id_ponto, tipo, hora, texto) values ($1,$2,$3,$4,$5)",
        [id, body.idPonto, body.tipo, body.hora, motivo.slice(0, 255)],
      );
      await client.query(`update dna_work.tabela_ponto set ${body.tipo === "entrada" ? "justificou_entrada" : "justificou_saida"} = 1 where id = $1`, [body.idPonto]);
      await client.query("commit");
      return { id };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async bater(idColaborador: string, confirmar: boolean, latitude: number | null, longitude: number | null, dispositivo: string) {
    const pessoa = await this.pessoa(idColaborador);
    // Horário de hoje lido antes de pegar a conexão (entrada nova é sempre de hoje).
    const hojeLegado = agoraSp().legado;
    const cargaHoje = await this.cargaDoDia(idColaborador, hojeLegado);
    const client = await this.db.connect();
    try {
      await client.query("begin");
      // A trava vem antes de decidir entrada/saída: com dois cliques ao mesmo tempo, o segundo espera o primeiro gravar
      // e já enxerga essa batida (sem a trava, os dois viam "entrada" e gravavam duas entradas abertas).
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`ponto-${pessoa.id_empresa}`]);
      const agora = agoraSp();
      // As leituras usam a mesma conexão: com vários cliques esperando a trava, o pool acabaria e tudo travaria.
      const bloqueio = await this.bloqueio(idColaborador, agora.legado, client);
      if (bloqueio) throw new AppError(409, "PONTO_BLOQUEADO", bloqueio);
      const decisao = await this.decidir(idColaborador, agora, client);
      const recente = await this.ultimaBatida(idColaborador, client);
      const minutos = recente ? minutosEntre(recente, agora) : null;
      // Menos de 1 minuto é clique repetido: não grava nem com confirmação. De 1 a 5 minutos, pergunta antes.
      if (minutos !== null && minutos < 1) throw new AppError(409, "PONTO_REPETIDO", "Seu ponto acabou de ser registrado. Atualize a tela.");
      if (minutos !== null && !confirmar && minutos < 5) {
        throw new AppError(409, "CONFIRMAR_PONTO", "A última batida foi há menos de 5 minutos.");
      }
      const carga = decisao.tipo !== "entrada" ? null : decisao.data === hojeLegado ? cargaHoje : await this.cargaDoDia(idColaborador, decisao.data);
      const nsr = await this.proximoNsr(client, pessoa.id_empresa, agora.iso);
      await this.gravarAfd(client, pessoa, nsr, agora);
      const coords = { latitude, longitude, dispositivo: dispositivo.slice(0, 100) };
      if (decisao.tipo === "entrada") {
        const id = await proximoId(client, "tabela_ponto");
        await client.query(`
          insert into dna_work.tabela_ponto
            (id, id_colaborador, data, entrada, entrada_editado, data_entrada, nsf_entrada,
             latitude_entrada, longitude_entrada, dispositivo_entrada, id_carga)
          values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10)
        `, [id, idColaborador, decisao.data, agora.hora, agora.legado, nsr, texto(coords.latitude), texto(coords.longitude), coords.dispositivo, carga && carga.length <= 10 ? carga : null]);
        await client.query("commit");
        return { id, tipo: "entrada" as const, data: dataBr(decisao.data), hora: agora.hora, nsr };
      }
      const saida = await client.query(`
        update dna_work.tabela_ponto
        set saida = $2, saida_editado = $2, data_saida = $3, nsf_saida = $4,
            latitude_saida = $5, longitude_saida = $6, dispositivo_saida = $7,
            horas_trabalhadas = $8
        where id = $1 and id_colaborador = $9 and (saida is null or saida = '')
      `, [
        decisao.id, agora.hora, agora.legado, nsr, texto(coords.latitude), texto(coords.longitude),
        Buffer.from(coords.dispositivo, "utf8"), horasEntre(decisao.entrada, agora.hora), idColaborador,
      ]);
      if (!saida.rowCount) throw new AppError(409, "PONTO_JA_FECHADO", "Essa saída já foi registrada. Atualize a tela.");
      await client.query("commit");
      return { id: decisao.id, tipo: "saida" as const, data: dataBr(decisao.data), hora: agora.hora, nsr };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async pessoa(idColaborador: string) {
    const result = await this.db.query<ColaboradorPonto>(`
      select col.id_colaborador, c.id_candidato, col.id_empresa, c.cpf, c.atualiza_senha,
             nullif(replace(left(col.data_inicio::text, 10), '-', '/'), '') as inicio,
             case when c.usanomesocial::text = '1' then coalesce(nullif(c.nomesocial, ''), c.nome) else c.nome end as nome,
             coalesce(e.nome_fantasia, e.razao_social, 'Empresa') as empresa
      from dna_work.colaborador col
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      join dna_work.empresa e on e.id_empresa = col.id_empresa
      where col.id_colaborador = $1 and col.status_ponto::text = '1' and e.ponto::text = '1'
    `, [idColaborador]);
    const pessoa = result.rows[0];
    if (!pessoa) throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
    return pessoa;
  }

  private async bloqueio(idColaborador: string, data: string, q: Consulta = this.db) {
    const ferias = await q.query(`
      select 1 from dna_work.ferias
      where id_colaborador = $1 and replace(inicio, '-', '/') <= $2 and replace(fim, '-', '/') >= $2
      limit 1
    `, [idColaborador, data]);
    if (ferias.rows.length) return "Você está de férias.";
    const atestado = await q.query(`
      select 1 from dna_work.atestado_medico
      where id_colaborador = $1 and replace(data, '-', '/') = $2 and dia_completo::text = '1'
      limit 1
    `, [idColaborador, data]);
    if (atestado.rows.length) return "Você está de atestado médico.";
    return null;
  }

  private async registros(idColaborador: string): Promise<RegistroPonto[]> {
    const rows = await this.db.query<Batida>(`
      select id, data, coalesce(nullif(entrada_editado, ''), entrada) as entrada, coalesce(nullif(saida_editado, ''), saida) as saida,
             nsf_entrada, nsf_saida, id_carga
      from dna_work.tabela_ponto
      where id_colaborador = $1 and coalesce(excluido, 0) = 0
      order by data desc, coalesce(nullif(btrim(entrada_editado), ''), entrada) desc, id desc
      limit 8
    `, [idColaborador]);
    return rows.rows.map((row) => ({
      id: row.id,
      data: dataBr(row.data),
      entrada: row.entrada,
      saida: row.saida,
      nsrEntrada: row.nsf_entrada,
      nsrSaida: row.nsf_saida,
    }));
  }

  private async decidir(idColaborador: string, agora: { legado: string; hora: string; iso: string }, q: Consulta = this.db) {
    const rows = await q.query<Batida>(`
      select id, data, coalesce(entrada_editado, entrada) as entrada, coalesce(saida_editado, saida) as saida,
             nsf_entrada, nsf_saida, id_carga
      from dna_work.tabela_ponto
      where id_colaborador = $1 and coalesce(excluido, 0) = 0
      order by data desc, coalesce(nullif(btrim(entrada_editado), ''), entrada) desc, id desc
      limit 1
    `, [idColaborador]);
    const ultimo = rows.rows[0];
    const ontem = diaAnterior(agora.iso);
    if (!ultimo || ultimo.saida) return { tipo: "entrada" as const, data: agora.legado, id: 0, entrada: "" };
    if (ultimo.data === agora.legado) return { tipo: "saida" as const, data: ultimo.data, id: ultimo.id, entrada: ultimo.entrada ?? "" };
    const noturno = await this.noturno(ultimo.id_carga, q);
    if (noturno && agora.hora < "12:00:00" && ultimo.data === ontem) {
      return { tipo: "saida" as const, data: ultimo.data, id: ultimo.id, entrada: ultimo.entrada ?? "" };
    }
    return { tipo: "entrada" as const, data: agora.legado, id: 0, entrada: "" };
  }

  private async ultimaBatida(idColaborador: string, q: Consulta = this.db) {
    const rows = await q.query<{ data: string; hora: string }>(`
      select data, coalesce(nullif(saida, ''), entrada) as hora
      from dna_work.tabela_ponto
      where id_colaborador = $1 and coalesce(excluido, 0) = 0 and coalesce(entrada, '') <> ''
      order by data desc, coalesce(nullif(btrim(entrada_editado), ''), entrada) desc, id desc
      limit 1
    `, [idColaborador]);
    return rows.rows[0] ?? null;
  }

  private async noturno(idCarga: string | null, q: Consulta = this.db) {
    if (!idCarga) return false;
    const carga = await q.query<{ entrada: string | null; saida: string | null }>(
      "select entrada, saida from dna_work.ponto_carga_base where id::text = $1",
      [idCarga],
    );
    const linha = carga.rows[0];
    return Boolean(linha?.entrada && linha.saida && linha.entrada > linha.saida);
  }

  private async cargaDoDia(idColaborador: string, data: string) {
    try {
      const especifica = await this.db.query<{ id_carga_horaria: string | null; id_escala: string | null }>(`
        select id_carga_horaria::text, id_escala::text
        from dna_work.ponto_data_trabalho
        where id_colaborador = $1 and replace(data, '-', '/') = $2
        limit 1
      `, [idColaborador, data]);
      const marcada = especifica.rows[0];
      if (marcada) return marcada.id_escala === "0" ? null : marcada.id_carga_horaria;
      const semana = await this.db.query<Record<string, string | null>>(`
        select tipo::text, segunda, segunda_carga::text, terca, terca_carga::text, quarta, quarta_carga::text,
               quinta, quinta_carga::text, sexta, sexta_carga::text, sabado, sabado_carga::text, domingo, domingo_carga::text
        from dna_work.carga_horaria
        where id_colaborador = $1
        limit 1
      `, [idColaborador]);
      const carga = semana.rows[0];
      const dia = DIAS[diaDaSemana(data)];
      if (carga?.tipo === "1" && carga[dia] !== "folga") return carga[`${dia}_carga`] || null;
    } catch {
      return this.cargaBase(idColaborador);
    }
    return this.cargaBase(idColaborador);
  }

  private async cargaBase(idColaborador: string) {
    const base = await this.db.query<{ carga_base: string | null }>(
      "select carga_base::text from dna_work.colaborador where id_colaborador = $1",
      [idColaborador],
    );
    return base.rows[0]?.carga_base ?? null;
  }

  private async proximoNsr(client: PoolClient, idEmpresa: string, dataIso: string) {
    const atualizado = await client.query<{ nsr: number }>(`
      update dna_work.ponto_nsr set nsr = coalesce(nsr, 0) + 1
      where id_empresa = $1
      returning nsr
    `, [idEmpresa]);
    if (atualizado.rows[0]) return atualizado.rows[0].nsr;
    await client.query("insert into dna_work.ponto_nsr (id_empresa, nsr, data_inicial) values ($1, 1, $2)", [idEmpresa, dataIso]);
    return 1;
  }

  /**
   * Registro tipo "7" do AFD (Portaria MTP 671/2021, Anexo V): data e hora no formato AAAA-MM-ddThh:mm:00-0300 (segundos
   * sempre "00"), marcação com a data e a hora reais do relógio (a saída de um turno noturno é do dia seguinte),
   * coletor "02" (navegador), "0" on-line e o hash SHA-256 dos campos 1 a 7 junto com o hash do registro anterior.
   * Roda dentro da trava da empresa, então o registro anterior (NSR - 1) já está gravado.
   */
  private async gravarAfd(client: PoolClient, pessoa: ColaboradorPonto, nsr: number, agora: { iso: string; hora: string }) {
    const minuto = `${agora.iso}T${agora.hora.slice(0, 5)}:00-0300`;
    const campos = `${String(nsr).padStart(9, "0")}7${minuto}${cpf12(pessoa.cpf)}${minuto}020`;
    const anterior = (await client.query<{ rash: string | null }>(
      "select rash from dna_work.ponto_afd where id_empresa = $1 and nsr = $2 and tipo = 7 order by data desc limit 1",
      [pessoa.id_empresa, nsr - 1],
    )).rows[0]?.rash ?? "";
    const hash = createHash("sha256").update(campos + anterior, "latin1").digest("hex");
    await client.query(`
      insert into dna_work.ponto_afd (nsr, id_empresa, id_colaborador, tipo, data, linha, rash)
      values ($1,$2,$3,7,$4,$5,$6)
    `, [nsr, pessoa.id_empresa, pessoa.id_colaborador, agora.iso, campos + hash, hash]);
  }

}

function agoraSp() {
  const texto = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  const [iso, hora] = texto.split(" ");
  return { iso, hora, legado: iso.replaceAll("-", "/") };
}

function diaAnterior(iso: string) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10).replaceAll("-", "/");
}

function diaAnteriorN(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10).replaceAll("-", "/");
}

function diaDaSemana(data: string) {
  const iso = data.replaceAll("/", "-");
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia, 15)).getUTCDay();
}

function dataBr(data: string) {
  const [ano, mes, dia] = data.replaceAll("-", "/").split("/");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : data;
}

function texto(valor: number | null) {
  return valor == null || Number.isNaN(valor) ? null : String(valor);
}

function cpf12(cpf: string | null) {
  return (cpf ?? "").replace(/\D/g, "").padStart(12, "0").slice(-12);
}

function minutosEntre(batida: { data: string; hora: string }, agora: { legado: string; hora: string }) {
  if (batida.data !== agora.legado) return 99;
    return (segundos(agora.hora) - segundos(batida.hora)) / 60;
}

function segundos(hora: string) {
  const [h, m, s] = hora.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function horasEntre(inicio: string, fim: string) {
  const total = Math.max(0, segundos(fim) - segundos(inicio));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((parte) => String(parte).padStart(2, "0")).join(":");
}
