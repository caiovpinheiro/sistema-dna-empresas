import crypto from "node:crypto";
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
    const contagem = await this.db.query<{ ativos: string; vagas: string; contratos: string; batidas: string }>(`
      select
        (select count(distinct pessoa)::text from (
          select cv.id_candidato as pessoa
          from dna_work.conratacaovaga cv
          left join dna_work.vaga v on v.id_vaga = cv.id_vaga
          where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
            and cv.status = 1
            and nullif(btrim(cv.data_demicao), '') is null
          union
          select col.id_candidato
          from dna_work.colaborador col
          where col.id_empresa = $1
            and coalesce(col.status_colaborador, 1) = 1
        ) pessoas) as ativos,
        (select count(*) from dna_work.vaga
          where id_empresa = $1 and coalesce(status, 0) <> 2)::text as vagas,
        (select count(*) from dna_work.conratacaovaga where id_empresa = $1)::text as contratos,
        (select count(*)::text
          from dna_work.tabela_ponto t
          join dna_work.colaborador col on col.id_colaborador = t.id_colaborador
          where col.id_empresa = $1
            and coalesce(t.excluido, 0) = 0
            and replace(t.data, '-', '/') like to_char((current_timestamp at time zone 'America/Sao_Paulo'), 'YYYY/MM') || '/%'
        ) as batidas
    `, [empresaId]);
    const empresa = await this.db.query<{ nome: string | null; cnpj: string | null; ponto: number | null }>(`
      select coalesce(nome_fantasia, razao_social) as nome, cnpj, ponto
      from dna_work.empresa where id_empresa = $1
    `, [empresaId]);
    return {
      empresa: empresa.rows[0]?.nome ?? "",
      cnpj: empresa.rows[0]?.cnpj ?? "",
      colaboradoresAtivos: Number(contagem.rows[0]?.ativos ?? 0),
      vagasAbertas: Number(contagem.rows[0]?.vagas ?? 0),
      contratos: Number(contagem.rows[0]?.contratos ?? 0),
      batidasMes: Number(contagem.rows[0]?.batidas ?? 0),
      pontoAtivo: Number(empresa.rows[0]?.ponto) === 1,
    };
  }

  async colaboradores(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select nome, email, celular, cargo, departamento, modalidade, contrato, datainicio, situacao
      from (
        select c.nome, c.email, c.celular, v.cargo, col.departamento, m.descricao as modalidade, m.descricao as contrato, cv.datainicio,
               case when cv.status = 2 or nullif(btrim(cv.data_demicao), '') is not null then 'Encerrado' else 'Ativo' end as situacao
        from dna_work.conratacaovaga cv
        join dna_work.candidato c on c.id_candidato = cv.id_candidato
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
        left join dna_work.colaborador col on col.id_candidato = c.id_candidato
          and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
        where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
          and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3 or coalesce(col.departamento, '') ilike $3)
        union all
        select c.nome, c.email, c.celular, col.cargo, col.departamento, m.descricao, m.descricao, col.data_inicio,
               case when col.status_colaborador = 1 then 'Ativo' else 'Inativo' end
        from dna_work.colaborador col
        join dna_work.candidato c on c.id_candidato = col.id_candidato
        left join dna_work.modalidade_vaga m on m.id::text = col.tipo_vaga::text
        where col.id_empresa = $1
          and not exists (
            select 1
            from dna_work.conratacaovaga cv
            left join dna_work.vaga v on v.id_vaga = cv.id_vaga
            where cv.id_candidato = col.id_candidato
              and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = col.id_empresa
          )
          and ($2 = '' or c.nome ilike $3 or coalesce(col.cargo, '') ilike $3 or coalesce(col.departamento, '') ilike $3)
      ) pessoas
      order by nome
      limit 500
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows;
  }

  async vagas(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select v.comparador as codigo, v.cargo, v.quantidade_posicoes as vagas, v.status, v.dataabertura, v.salario, v.cidade, v.periodo, m.descricao as contrato
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
      select c.nome, v.cargo, m.descricao as contrato, cv.datainicio, cv.data_demicao, cv.status,
             (select col.departamento from dna_work.colaborador col
               where col.id_candidato = c.id_candidato and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
               limit 1) as departamento
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
        and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3)
      order by cv.data_contratacao desc nulls last
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows.map((row) => ({
      nome: row.nome,
      cargo: row.cargo,
      departamento: row.departamento,
      contrato: row.contrato,
      inicio: row.datainicio,
      situacao: row.data_demicao || Number(row.status) === 2 ? "Encerrado" : "Ativo",
    }));
  }

  async escalas(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select id, nome,
             case when segunda_feira::text = '1' then 'Trabalha' else 'Folga' end as segunda,
             case when terca_feira::text = '1' then 'Trabalha' else 'Folga' end as terca,
             case when quarta_feira::text = '1' then 'Trabalha' else 'Folga' end as quarta,
             case when quinta_feira::text = '1' then 'Trabalha' else 'Folga' end as quinta,
             case when sexta_feira::text = '1' then 'Trabalha' else 'Folga' end as sexta,
             case when sabado::text = '1' then 'Trabalha' else 'Folga' end as sabado,
             case when domingo::text = '1' then 'Trabalha' else 'Folga' end as domingo
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
    const nome = body.nome?.trim() ?? "";
    const cpf = (body.cpf ?? "").replace(/\D/g, "").slice(0, 11);
    const cargo = (body.cargo ?? "").trim().slice(0, 255);
    if (nome.length < 2) throw new AppError(422, "NOME_CURTO", "Informe o nome do colaborador.");
    if (cpf.length !== 11) throw new AppError(422, "CPF_INVALIDO", "Informe o CPF com 11 números.");
    if (cargo.length < 2) throw new AppError(422, "CARGO_CURTO", "Informe o cargo.");
    const existente = await this.db.query<{ id_candidato: string }>(`
      select id_candidato from dna_work.candidato
      where regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = $1
      limit 1
    `, [cpf]);
    const idCandidato = existente.rows[0]?.id_candidato ?? crypto.randomUUID();
    const inicio = body.inicio ? dataLegado(body.inicio) : dataLegado(new Date().toISOString().slice(0, 10));
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (!existente.rows[0]) {
        await client.query(`
          insert into dna_work.candidato (id_candidato, nome, cpf, email, celular, datacadastro, id_empresa, colaborador)
          values ($1,$2,$3,$4,$5,$6,$7,1)
        `, [idCandidato, nome, cpf, body.email?.trim() || null, (body.celular ?? "").trim().slice(0, 40) || null, inicio, empresaId]);
      }
      const idColaborador = crypto.randomUUID();
      await client.query(`
        insert into dna_work.colaborador
          (id_colaborador, id_candidato, id_empresa, data_inicio, departamento, cargo, data_cadastro, status_ponto, status_colaborador)
        values ($1,$2,$3,$4,$5,$6,$7,1,1)
      `, [idColaborador, idCandidato, empresaId, inicio, body.departamento?.trim().slice(0, 255) || null, cargo, dataLegado(new Date().toISOString().slice(0, 10))]);
      await client.query("COMMIT");
      return { id: idColaborador };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
      select c.nome,
             t.data,
             coalesce(nullif(btrim(t.entrada_editado), ''), t.entrada) as entrada,
             coalesce(nullif(btrim(t.saida_editado), ''), t.saida) as saida,
             t.horas_trabalhadas as horas
      from dna_work.tabela_ponto t
      join dna_work.colaborador col on col.id_colaborador = t.id_colaborador
      left join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_empresa = $1
        and coalesce(t.excluido, 0) = 0
        and t.data ~ '^[0-9]{4}[/-][0-9]{2}[/-][0-9]{2}$'
      order by replace(t.data, '-', '/') desc, t.id desc
      limit 200
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

  async empresa(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const atual = await this.db.query(`
      select coalesce(nome_fantasia, razao_social) as nome, razao_social, cnpj, email, telefone, cidade, uf, responsavel
      from dna_work.empresa where id_empresa = $1
    `, [empresaId]);
    const filiais = await this.db.query(`
      select coalesce(nome_fantasia, razao_social) as nome, cnpj, cidade
      from dna_work.empresa where matriz = $1 order by nome
    `, [empresaId]);
    return { ...(atual.rows[0] ?? {}), filiais: filiais.rows };
  }

  async salvarFilial(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const id = crypto.randomUUID();
    await this.db.query(`
      insert into dna_work.empresa (id_empresa, nome_fantasia, razao_social, cnpj, email, cidade, matriz, tipo_empresa, status)
      values ($1,$2,$2,$3,$4,$5,$6,2,1)
    `, [id, body.nome, body.cnpj || null, body.email || null, body.cidade || null, empresaId]);
    return { id };
  }

  async usuarios(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select u.id_u as id, u.nome_u as nome, u.email_u as email, u.telefone_u as telefone,
             case u.tipo::text
               when '1' then 'Administrador'
               when '2' then 'Gerente'
               when '3' then 'Comercial'
               when '4' then 'Operador'
               else coalesce(u.tipo::text, '')
             end as tipo,
             case when u.status = 1 then 'Ativo' else 'Inativo' end as situacao
      from dna_work.usuario_empresa u
      where u.empresa_u = $1
         or u.id_u = $2
         or exists (
           select 1 from dna_work.vinculo_empresa_usuario v
           where v.id_usuario = u.id_u and v.id_empresa = $1
         )
      order by u.nome_u
    `, [empresaId, usuarioId]);
    return rows.rows;
  }

  async salvarUsuario(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const nome = body.nome?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const senha = body.senha ?? "";
    const telefone = (body.telefone ?? "").trim().slice(0, 20);
    if (nome.length < 2) throw new AppError(422, "NOME_CURTO", "Informe o nome do usuário.");
    if (!email.includes("@")) throw new AppError(422, "EMAIL_INVALIDO", "Informe um e-mail válido.");
    if (senha.length < 6) throw new AppError(422, "SENHA_CURTA", "A senha precisa ter pelo menos 6 caracteres.");
    const id = crypto.randomUUID();
    const { hash } = await import("@node-rs/argon2");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        insert into dna_work.usuario_empresa
          (id_u, nome_u, email_u, senha_u, senha_hash, telefone_u, empresa_u, status, tipo, data_senha, atualiza_senha)
        values ($1,$2,$3,$4,$5,$6,$7,1,1,to_char(current_date,'YYYY/MM/DD'),0)
      `, [id, nome, email, crypto.createHash("md5").update(senha).digest("hex"), await hash(senha), telefone, empresaId]);
      await client.query(`insert into dna_work.vinculo_empresa_usuario (id_usuario, id_empresa) values ($1,$2)`, [id, empresaId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(409, "USUARIO_DUPLICADO", "Já existe um usuário com estes dados.");
      }
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.db.query(`
        insert into dna_work.paginas_usuario_empresa (id_usuario, menu, sub1, sub2, paginas)
        select $1, menu, sub1, sub2, paginas from dna_work.paginas_usuario_empresa where id_usuario = $2 limit 1
      `, [id, usuarioId]);
    } catch {
      // O usuário já está na empresa. A cópia do menu não pode apagar o cadastro.
    }
    return { id, nome, email };
  }

  async talentos(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select nome, cpf, email, celular, bairro, cidade, estado, curso, modalidadecurso as ensino, datacadastro
      from dna_work.candidato
      where id_empresa = $1 order by nome limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async salvarTalento(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const id = crypto.randomUUID();
    await this.db.query(`
      insert into dna_work.candidato (id_candidato, nome, cpf, email, celular, cidade, datacadastro, id_empresa)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [id, body.nome, body.cpf || null, body.email || null, body.celular || null, body.cidade || null, dataLegado(new Date().toISOString().slice(0, 10)), empresaId]);
    return { id };
  }

  async encaminhamentos(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, v.cargo, e.data, e.data_entrevista, e.hora,
             case when e.compareceu = '1' then 'Compareceu' when e.reprovado = 'S' then 'Reprovado' else 'Encaminhado' end as situacao
      from dna_work.emcaminhamento e
      join dna_work.vaga v on v.id_vaga = e.id_vaga
      left join dna_work.candidato c on c.id_candidato = e.id_candidato
      where v.id_empresa = $1
      order by e.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async documentos(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, g.nome_contrato as documentos, g.datainicio as inicio,
             case when g.devolvido::text in ('1', 'S', 's') then 'Devolvido' else 'Pendente' end as situacao
      from dna_work.contratos_gerados g
      left join dna_work.candidato c on c.id_candidato = g.id_candidato
      where g.id_empresa = $1
      order by g.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async seguro(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, v.cargo, g.datainicio as inicio, g.datafim as fim, c.cpf
      from dna_work.contratos_gerados g
      join dna_work.candidato c on c.id_candidato = g.id_candidato
      left join dna_work.vaga v on v.id_vaga::text = g.vaga::text
      where g.id_empresa = $1
      order by g.datainicio desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async calendario(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select coalesce(nullif(btrim(d.title), ''), v.cargo) as nome, v.cargo, d.data, d.inicio as hora, d.termino, d.link
      from dna_work.entrevista_datas d
      join dna_work.vaga v on v.comparador::text = d.comparador::text
      where v.id_empresa = $1
      order by d.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async avaliacoes(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.nome, a.ciclo, a.area, a.data,
             case when a.completou_ciclo = '1' then 'Concluída' else 'Em aberto' end as situacao
      from dna_work.avaliacao_desepenho a
      join dna_work.colaborador col on col.id_colaborador = a.id_colaborador
      left join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_empresa = $1
      order by a.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async holerites(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select h.nome_candidato as nome, h.cargo, h.copentencia as competencia, h.salario_brudo as bruto,
             coalesce(h.saldo_salario, h.total_vencimentos) as liquido
      from dna_work.holerite h
      join dna_work.vaga v on v.id_vaga = h.id_vaga
      where v.id_empresa = $1
      order by h.copentencia desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
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
