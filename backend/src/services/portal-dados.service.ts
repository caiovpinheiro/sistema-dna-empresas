import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";

function dia(valor: string | undefined) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function dataLegado(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${ano}/${mes}/${dia}` : iso;
}

export class PortalDadosService {
  constructor(private readonly db: Pool) {}

  async painel(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const contagem = await this.db.query<{ ativos: string; vagas: string; contratos: string }>(`
      select
        (select count(*) from dna_work.conratacaovaga
          where id_empresa = $1 and status = 1 and coalesce(data_demicao, '') = '')::text as ativos,
        (select count(*) from dna_work.vaga
          where id_empresa = $1 and coalesce(status, 0) <> 2)::text as vagas,
        (select count(*) from dna_work.conratacaovaga where id_empresa = $1)::text as contratos
    `, [empresaId]);
    const empresa = await this.db.query<{ nome: string | null; cnpj: string | null }>(`
      select coalesce(nome_fantasia, razao_social) as nome, cnpj
      from dna_work.empresa where id_empresa = $1
    `, [empresaId]);
    return {
      empresa: empresa.rows[0]?.nome ?? "",
      cnpj: empresa.rows[0]?.cnpj ?? "",
      colaboradoresAtivos: Number(contagem.rows[0]?.ativos ?? 0),
      vagasAbertas: Number(contagem.rows[0]?.vagas ?? 0),
      contratos: Number(contagem.rows[0]?.contratos ?? 0),
    };
  }

  async colaboradores(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, c.email, c.celular, v.cargo, m.descricao as contrato, cv.datainicio
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where cv.id_empresa = $1
        and cv.status = 1
        and coalesce(cv.data_demicao, '') = ''
        and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3)
      order by c.nome
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows;
  }

  async vagas(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select v.id_vaga, v.cargo, v.status, v.dataabertura, v.salario, v.cidade, m.descricao as contrato
      from dna_work.vaga v
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where v.id_empresa = $1
        and ($2 = '' or v.cargo ilike $3)
      order by v.dataabertura desc nulls last
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows.map((row) => ({
      ...row,
      situacao: Number(row.status) === 2 ? "Encerrada" : "Aberta",
    }));
  }

  async contratados(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, v.cargo, m.descricao as contrato, cv.datainicio, cv.data_demicao, cv.status
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where cv.id_empresa = $1
        and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3)
      order by cv.data_contratacao desc nulls last
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows.map((row) => ({
      nome: row.nome,
      cargo: row.cargo,
      contrato: row.contrato,
      inicio: row.datainicio,
      situacao: row.data_demicao || Number(row.status) === 2 ? "Encerrado" : "Ativo",
    }));
  }

  async escalas(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select id, nome, segunda_feira, terca_feira, quarta_feira, quinta_feira, sexta_feira, sabado, domingo
      from dna_work.ponto_turno_base
      where id_empresa = $1
      order by nome
    `, [empresaId]);
    return rows.rows;
  }

  async salvarEscala(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const id = await this.proximo("ponto_turno_base", "id");
    await this.db.query(`
      insert into dna_work.ponto_turno_base
        (id, nome, id_empresa, segunda_feira, terca_feira, quarta_feira, quinta_feira, sexta_feira, sabado, domingo)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [id, body.nome, empresaId, dia(body.segunda), dia(body.terca), dia(body.quarta), dia(body.quinta), dia(body.sexta), dia(body.sabado), dia(body.domingo)]);
    return { id };
  }

  async cargas(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select id, nome, tipo, entrada, saida_refeicao, retorno_refeicao, saida, tolerancia, pausa
      from dna_work.ponto_carga_base
      where id_empresa = $1
      order by nome
    `, [empresaId]);
    return rows.rows;
  }

  async salvarCarga(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const pausa = body.pausa === "1" ? 1 : 0;
    const saida = body.saida;
    const id = await this.proximo("ponto_carga_base", "id");
    await this.db.query(`
      insert into dna_work.ponto_carga_base
        (id, id_empresa, nome, tipo, entrada, saida_refeicao, retorno_refeicao, saida, tolerancia, pausa)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      id, empresaId, body.nome, body.tipo === "Noturno" ? "Noturno" : "Diurno",
      body.entrada, pausa ? body.saidaRefeicao : saida, pausa ? body.retornoRefeicao : saida, saida, body.tolerancia || "0", pausa,
    ]);
    return { id };
  }

  async feriados(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select id_feriado, nome, data from dna_work.feriados where id_empresa = $1 order by data
    `, [empresaId]);
    return rows.rows;
  }

  async salvarFeriado(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const id = await this.proximo("feriados", "id_feriado");
    await this.db.query(`
      insert into dna_work.feriados (id_feriado, nome, data, id_empresa) values ($1,$2,$3,$4)
    `, [id, body.nome, dataLegado(body.data), empresaId]);
    return { id };
  }

  async salvarColaborador(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const cpf = body.cpf.replace(/\D/g, "");
    const existente = cpf
      ? await this.db.query<{ id_candidato: string }>(`select id_candidato from dna_work.candidato where regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = $1 limit 1`, [cpf])
      : { rows: [] };
    const idCandidato = existente.rows[0]?.id_candidato ?? crypto.randomUUID();
    if (!existente.rows[0]) {
      await this.db.query(`
        insert into dna_work.candidato (id_candidato, nome, cpf, email, celular, datacadastro, id_empresa, colaborador)
        values ($1,$2,$3,$4,$5,$6,$7,1)
      `, [idCandidato, body.nome, cpf, body.email || null, body.celular || null, dataLegado(new Date().toISOString().slice(0, 10)), empresaId]);
    }
    const idColaborador = crypto.randomUUID();
    await this.db.query(`
      insert into dna_work.colaborador
        (id_colaborador, id_candidato, id_empresa, data_inicio, departamento, cargo, data_cadastro, status_ponto, status_colaborador, carga_base)
      values ($1,$2,$3,$4,$5,$6,$7,1,1,$8)
    `, [idColaborador, idCandidato, empresaId, dataLegado(body.inicio), body.departamento || null, body.cargo, dataLegado(new Date().toISOString().slice(0, 10)), body.carga ? Number(body.carga) : null]);
    return { id: idColaborador };
  }

  async salvarVaga(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const tipo = Number(body.tipo);
    if (![1, 2, 4].includes(tipo)) throw new AppError(422, "TIPO_INVALIDO", "A vaga precisa ser estágio, CLT ou PJ.");
    const id = crypto.randomUUID();
    await this.db.query(`
      insert into dna_work.vaga
        (id_vaga, id_empresa, cargo, tipo_vaga, salario, cidade, status, dataabertura, comparador, quantidade_posicoes)
      values ($1,$2,$3,$4,$5,$6,0,$7,$1,1)
    `, [id, empresaId, body.cargo, tipo, body.salario || null, body.cidade || null, dataLegado(new Date().toISOString().slice(0, 10))]);
    return { id };
  }

  async relatorioPonto(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, col.cargo, col.departamento, col.data_inicio, carga.nome as carga
      from dna_work.colaborador col
      left join dna_work.candidato c on c.id_candidato = col.id_candidato
      left join dna_work.ponto_carga_base carga on carga.id = col.carga_base
      where col.id_empresa = $1 and col.status_ponto = 1
      order by c.nome
    `, [empresaId]);
    return rows.rows;
  }

  async faturas(usuarioId: string, empresaId: string, situacao: string) {
    await this.garantir(usuarioId, empresaId);
    const novas = await this.db.query<{
      id: string; valor: string; vencimento: string; pagamento: string | null; link: string | null; situacao: string; competencia: string | null; asaas: string | null;
    }>(`
      select id::text, valor::text, vencimento::text, data_pagamento::text as pagamento,
             url_pagamento as link, situacao, descricao as competencia, asaas_payment_id as asaas
      from dna_work.cobranca_asaas
      where id_empresa = $1 and situacao <> 'cancelada'
    `, [empresaId]);
    const antigas = await this.db.query<{
      id: string; valor: string | null; vencimento: string | null; pagamento: string | null; link: string | null; status_fatura: string | null; mes: string | null; ano: string | null; asaas: string | null;
    }>(`
      select id_fatura::text as id, valor_final as valor, vencimento_fatura as vencimento, data_pg as pagamento,
             url_pg as link, status_fatura::text, mes::text, ano::text, id_asaas as asaas
      from dna_work.fatura
      where id_empresa = $1 and (tipo_fatura is null or tipo_fatura ilike 'padr%')
    `, [empresaId]);
    const jaVeioDoAsaas = new Set(novas.rows.map((item) => item.asaas).filter(Boolean));
    const lista = [
      ...novas.rows.map((item) => ({
        id: item.id,
        valor: item.valor,
        vencimento: item.vencimento,
        pagamento: item.pagamento,
        link: item.link,
        situacao: item.situacao === "paga" ? "Paga" : "Aberta",
        competencia: item.competencia,
      })),
      ...antigas.rows.filter((item) => !item.asaas || !jaVeioDoAsaas.has(item.asaas)).map((item) => ({
        id: item.id,
        valor: item.valor,
        vencimento: item.vencimento,
        pagamento: item.pagamento,
        link: item.link,
        situacao: item.status_fatura === "0" ? "Aberta" : "Paga",
        competencia: item.mes && item.ano ? `${item.mes}/${item.ano}` : null,
      })),
    ].filter((item) => situacao === "todas" || (situacao === "paga" ? item.situacao === "Paga" : item.situacao === "Aberta"));
    return lista.sort((a, b) => String(b.vencimento ?? "").localeCompare(String(a.vencimento ?? "")));
  }

  private async proximo(tabela: "ponto_turno_base" | "ponto_carga_base" | "feriados", coluna: "id" | "id_feriado") {
    const linha = await this.db.query<{ id: string }>(`select coalesce(max(${coluna}), 0) + 1 as id from dna_work.${tabela}`);
    return Number(linha.rows[0].id);
  }

  private async garantir(usuarioId: string, empresaId: string) {
    const acesso = await this.db.query(`
      select 1 from dna_work.usuario_empresa where id_u = $1 and empresa_u = $2 and status = 1
      union
      select 1 from dna_work.vinculo_empresa_usuario where id_usuario = $1 and id_empresa = $2
    `, [usuarioId, empresaId]);
    if (!acesso.rowCount) throw new AppError(403, "EMPRESA_NEGADA", "Esta empresa não está vinculada ao usuário.");
  }
}
