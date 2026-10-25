import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../lib/errors.js";

export type SessaoPonto = {
  nome: string;
  empresa: string;
  acao: "entrada" | "saida" | "bloqueado";
  motivo: string | null;
  registros: RegistroPonto[];
};

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
  pin: string | number | null;
  cpf: string | null;
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
    const encontrado = await this.db.query<ColaboradorPonto & { senha: string | null }>(`
      select col.id_colaborador, c.id_candidato, col.id_empresa, c.senha, col.pin, c.cpf,
             case when c.usanomesocial::text = '1' then coalesce(nullif(c.nomesocial, ''), c.nome) else c.nome end as nome,
             coalesce(e.nome_fantasia, e.razao_social, 'Empresa') as empresa
      from dna_work.candidato c
      join dna_work.colaborador col on col.id_candidato = c.id_candidato and col.id_empresa = c.id_empresa
      join dna_work.empresa e on e.id_empresa = col.id_empresa
      where regexp_replace(coalesce(c.cpf, ''), '\\D', '', 'g') = $1
        and c.colaborador::text = '1'
        and col.status_ponto::text = '1'
        and e.ponto::text = '1'
      order by col.data_inicio desc nulls last
      limit 1
    `, [digitos]);
    const pessoa = encontrado.rows[0];
    const hash = createHash("md5").update(senha).digest("hex");
    if (!pessoa?.senha || pessoa.senha.toLowerCase() !== hash) {
      throw new AppError(401, "LOGIN_INVALIDO", "CPF ou senha inválidos.");
    }
    return {
      id_colaborador: pessoa.id_colaborador,
      id_candidato: pessoa.id_candidato,
      id_empresa: pessoa.id_empresa,
      nome: pessoa.nome,
      empresa: pessoa.empresa,
      pin: pessoa.pin,
      cpf: pessoa.cpf,
    };
  }

  async painel(idColaborador: string): Promise<SessaoPonto> {
    const pessoa = await this.pessoa(idColaborador);
    const agora = agoraSp();
    const bloqueio = await this.bloqueio(idColaborador, agora.legado);
    const registros = await this.registros(idColaborador);
    if (bloqueio) return { nome: pessoa.nome, empresa: pessoa.empresa, acao: "bloqueado", motivo: bloqueio, registros };
    const decisao = await this.decidir(idColaborador, agora);
    return { nome: pessoa.nome, empresa: pessoa.empresa, acao: decisao.tipo, motivo: null, registros };
  }

  async bater(idColaborador: string, pin: string, confirmar: boolean, latitude: number | null, longitude: number | null, dispositivo: string) {
    const pessoa = await this.pessoa(idColaborador);
    if (!pessoa.pin || String(pessoa.pin).trim() !== pin.trim()) throw new AppError(422, "PIN_INVALIDO", "PIN inválido.");
    const agora = agoraSp();
    const bloqueio = await this.bloqueio(idColaborador, agora.legado);
    if (bloqueio) throw new AppError(409, "PONTO_BLOQUEADO", bloqueio);
    const decisao = await this.decidir(idColaborador, agora);
    const recente = await this.ultimaBatida(idColaborador);
    if (recente && !confirmar && minutosEntre(recente, agora) < 5) {
      throw new AppError(409, "CONFIRMAR_PONTO", "A última batida foi há menos de 5 minutos.");
    }
    const carga = decisao.tipo === "entrada" ? await this.cargaDoDia(idColaborador, decisao.data) : null;
    const client = await this.db.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`ponto-${pessoa.id_empresa}`]);
      const nsr = await this.proximoNsr(client, pessoa.id_empresa, agora.iso);
      await this.gravarAfd(client, pessoa, nsr, agora, decisao.data);
      const coords = { latitude, longitude, dispositivo: dispositivo.slice(0, 100) };
      if (decisao.tipo === "entrada") {
        const id = await this.proximoPonto(client);
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
      select col.id_colaborador, c.id_candidato, col.id_empresa, col.pin, c.cpf,
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

  private async bloqueio(idColaborador: string, data: string) {
    const ferias = await this.db.query(`
      select 1 from dna_work.ferias
      where id_colaborador = $1 and replace(inicio, '-', '/') <= $2 and replace(fim, '-', '/') >= $2
      limit 1
    `, [idColaborador, data]);
    if (ferias.rows.length) return "Você está de férias.";
    const atestado = await this.db.query(`
      select 1 from dna_work.atestado_medico
      where id_colaborador = $1 and replace(data, '-', '/') = $2 and dia_completo::text = '1'
      limit 1
    `, [idColaborador, data]);
    if (atestado.rows.length) return "Você está de atestado médico.";
    return null;
  }

  private async registros(idColaborador: string): Promise<RegistroPonto[]> {
    const rows = await this.db.query<Batida>(`
      select id, data, entrada, saida, nsf_entrada, nsf_saida, id_carga
      from dna_work.tabela_ponto
      where id_colaborador = $1 and coalesce(excluido, 0) = 0
      order by data desc, id desc
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

  private async decidir(idColaborador: string, agora: { legado: string; hora: string; iso: string }) {
    const rows = await this.db.query<Batida>(`
      select id, data, coalesce(entrada_editado, entrada) as entrada, coalesce(saida_editado, saida) as saida,
             nsf_entrada, nsf_saida, id_carga
      from dna_work.tabela_ponto
      where id_colaborador = $1 and coalesce(excluido, 0) = 0
      order by data desc, id desc
      limit 1
    `, [idColaborador]);
    const ultimo = rows.rows[0];
    const ontem = diaAnterior(agora.iso);
    if (!ultimo || ultimo.saida) return { tipo: "entrada" as const, data: agora.legado, id: 0, entrada: "" };
    if (ultimo.data === agora.legado) return { tipo: "saida" as const, data: ultimo.data, id: ultimo.id, entrada: ultimo.entrada ?? "" };
    const noturno = await this.noturno(ultimo.id_carga);
    if (noturno && agora.hora < "12:00:00" && ultimo.data === ontem) {
      return { tipo: "saida" as const, data: ultimo.data, id: ultimo.id, entrada: ultimo.entrada ?? "" };
    }
    return { tipo: "entrada" as const, data: agora.legado, id: 0, entrada: "" };
  }

  private async ultimaBatida(idColaborador: string) {
    const rows = await this.db.query<{ data: string; hora: string }>(`
      select data, coalesce(nullif(saida, ''), entrada) as hora
      from dna_work.tabela_ponto
      where id_colaborador = $1 and coalesce(excluido, 0) = 0 and coalesce(entrada, '') <> ''
      order by data desc, id desc
      limit 1
    `, [idColaborador]);
    return rows.rows[0] ?? null;
  }

  private async noturno(idCarga: string | null) {
    if (!idCarga) return false;
    const carga = await this.db.query<{ entrada: string | null; saida: string | null }>(
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

  private async proximoPonto(client: PoolClient) {
    const result = await client.query<{ id: number }>("select coalesce(max(id), 0) + 1 as id from dna_work.tabela_ponto");
    return result.rows[0].id;
  }

  private async gravarAfd(client: PoolClient, pessoa: ColaboradorPonto, nsr: number, agora: { iso: string; hora: string }, dataPonto: string) {
    const marca = `${dataPonto.replaceAll("/", "-")}T${agora.hora}-0300`;
    const gravacao = `${agora.iso}T${agora.hora}-0300`;
    const linha = `${String(nsr).padStart(9, "0")}7${marca}${cpf12(pessoa.cpf)}${gravacao}020`;
    await client.query(`
      insert into dna_work.ponto_afd (nsr, id_empresa, id_colaborador, tipo, data, linha)
      values ($1,$2,$3,7,$4,$5)
    `, [nsr, pessoa.id_empresa, pessoa.id_colaborador, agora.iso, linha]);
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
