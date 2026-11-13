import crypto from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { postServico } from "../lib/servico.js";

function dia(valor: string | undefined) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function dataLegado(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${ano}/${mes}/${dia}` : iso;
}

/** Valor em reais no formato do sistema antigo ("1500,00"). Aceita 1500, 1.500, 1.500,00 e R$ 1500,5. */
function valorLegado(entrada: string) {
  let valor = entrada.replace(/R\$|\s/gi, "");
  if (!valor) return null;
  if (valor.includes(",")) {
    const [inteiro, centavos = ""] = valor.split(",");
    valor = `${inteiro.replace(/\./g, "")}.${centavos}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(valor)) {
    valor = valor.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(valor)) return null;
  return Number(valor).toFixed(2).replace(".", ",");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Código de "Ensino médio" em dna_work.flex: é o que o interno grava na vaga de estágio que aceita ensino médio. */
const ESCOLARIDADE_ENSINO_MEDIO = "31";

/** Mesmas regras da "Nova vaga" do interno, com mensagens por campo para o formulário do portal. */
function validarVaga(body: Record<string, string>) {
  const campos: Record<string, string> = {};
  const texto = (chave: string, limite = 4000) => String(body[chave] ?? "").trim().slice(0, limite);
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const tipo = Number(body.tipo);
  if (tipo === 4) throw new AppError(422, "TIPO_INDISPONIVEL", "Não abrimos mais vaga PJ.");
  if (![1, 2].includes(tipo)) throw new AppError(422, "TIPO_INVALIDO", "A vaga precisa ser estágio ou CLT.");
  const cargo = texto("cargo", 180);
  if (cargo.length < 2) campos.cargo = "Informe o cargo da vaga.";
  const quantidade = Number(body.quantidade || 1);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 20) campos.quantidade = "Use um número de 1 a 20.";
  const salario = valorLegado(texto("salario", 40));
  if (!salario) campos.salario = "Informe o valor só com números, como 1.500,00.";
  const cargaHoraria = texto("cargaHoraria", 3);
  if (!(tipo === 1 ? ["20", "30"] : ["40", "44"]).includes(cargaHoraria)) campos.cargaHoraria = tipo === 1 ? "Estágio usa 20 ou 30 horas por semana." : "CLT usa 40 ou 44 horas por semana.";
  const entrada = texto("entrada", 5);
  const saida = texto("saida", 5);
  if (!hora.test(entrada)) campos.entrada = "Informe a entrada.";
  if (!hora.test(saida)) campos.saida = "Informe a saída.";
  let sabado: { entrada: string; saida: string } | null = null;
  if (body.sabado === "sim") {
    sabado = { entrada: texto("sabadoEntrada", 5), saida: texto("sabadoSaida", 5) };
    if (!hora.test(sabado.entrada) || !hora.test(sabado.saida)) campos.sabado = "Informe a entrada e a saída do sábado.";
  }
  const sexo = ["M", "F", "I"].includes(body.sexo) ? body.sexo : "I";
  const idade = Number(body.idade);
  const idadeAte = Number(body.idadeAte);
  if (!Number.isInteger(idade) || idade < 14 || idade > 80) campos.idade = "Idade de 14 a 80.";
  if (!Number.isInteger(idadeAte) || idadeAte < 14 || idadeAte > 80) campos.idadeAte = "Idade de 14 a 80.";
  else if (Number.isInteger(idade) && idadeAte < idade) campos.idadeAte = "Menor que a idade inicial.";
  let aceitaMedio = false;
  if (tipo === 1) {
    if (body.aceitaMedio !== "sim" && body.aceitaMedio !== "nao") campos.aceitaMedio = "Diga se a vaga aceita estudante do ensino médio.";
    aceitaMedio = body.aceitaMedio === "sim";
  }
  const atividades = texto("atividades");
  const requisitos = texto("requisitos");
  if (atividades.length < 3) campos.atividades = "Descreva o que a pessoa vai fazer.";
  if (requisitos.length < 3) campos.requisitos = "Diga o que a pessoa precisa ter ou saber.";
  const primeiro = Object.values(campos)[0];
  if (primeiro) throw new AppError(422, "VALIDACAO", Object.keys(campos).length > 1 ? "Confira os campos marcados." : primeiro, campos);
  return {
    tipo, cargo, quantidade, salario: salario!, cargaHoraria, entrada, saida, sabado, sexo, idade, idadeAte, aceitaMedio,
    atividades, requisitos, beneficios: texto("beneficios") || null,
  };
}

function situacaoVaga(status: unknown) {
  const codigo = Number(status);
  if ([0, 3, 4, 5, 9].includes(codigo)) return "Aberta";
  if (codigo === 8) return "Pausada";
  if (codigo === 1) return "Contratada";
  return "Fechada";
}

function dataValida(valor: string | undefined) {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;
}

function dataSp(dias: number) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return dataSpDe(hoje, dias);
}

function dataSpDe(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function intervalo(de: string, ate: string) {
  const dias: string[] = [];
  const inicio = new Date(`${de}T12:00:00Z`).getTime();
  const fim = new Date(`${ate}T12:00:00Z`).getTime();
  for (let cursor = Math.min(inicio, fim); cursor <= Math.max(inicio, fim) && dias.length < 62; cursor += 86_400_000) {
    dias.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dias;
}

function minutosRelogio(valor: string | null | undefined) {
  if (!valor) return null;
  const [hora, minuto] = valor.trim().replace(/^-/, "").split(":");
  if (hora === undefined || minuto === undefined || hora === "") return null;
  const h = Number(hora);
  const m = Number(minuto);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
}

function relogio(minutos: number) {
  const absoluto = Math.abs(Math.round(minutos));
  const hora = Math.floor(absoluto / 60);
  const minuto = absoluto % 60;
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00`;
}

function minutosDaCarga(carga: { entrada: string | null; saida_refeicao: string | null; retorno_refeicao: string | null; saida: string | null } | undefined) {
  const entrada = minutosRelogio(carga?.entrada);
  const saida = minutosRelogio(carga?.saida);
  if (entrada === null || saida === null) return 0;
  let total = saida - entrada;
  if (total < 0) total += 24 * 60;
  const pausaSaida = minutosRelogio(carga?.saida_refeicao);
  const pausaVolta = minutosRelogio(carga?.retorno_refeicao);
  if (pausaSaida !== null && pausaVolta !== null && pausaVolta !== saida) {
    let pausa = pausaVolta - pausaSaida;
    if (pausa < 0) pausa += 24 * 60;
    total -= pausa;
  }
  return Math.max(0, total);
}

function minutosTrabalhados(batidas: Array<{ entrada: string | null; saida: string | null; horas: string | null }>, horasBanco: string | null | undefined) {
  const pelasBatidas = batidas.reduce((soma, batida) => {
    const registrada = minutosRelogio(batida.horas);
    if (registrada) return soma + registrada;
    const entrada = minutosRelogio(batida.entrada);
    const saida = minutosRelogio(batida.saida);
    if (entrada === null || saida === null) return soma;
    const intervaloBatida = saida - entrada;
    return soma + (intervaloBatida < 0 ? intervaloBatida + 24 * 60 : intervaloBatida);
  }, 0);
  if (pelasBatidas > 0) return pelasBatidas;
  return minutosRelogio(horasBanco) ?? 0;
}

function dinheiro(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = String(valor).trim();
  if (!texto || texto === "0" || texto === "0.00") return texto;
  return texto.startsWith("R$") ? texto : `R$ ${texto}`;
}

function ficha(titulo: unknown, subtitulo: unknown, campos: Array<[string, unknown]>) {
  return {
    titulo: titulo ? String(titulo) : "Registro",
    subtitulo: subtitulo ? String(subtitulo) : "",
    campos: campos.map(([rotulo, valor]) => ({
      rotulo,
      valor: valor === null || valor === undefined || String(valor).trim() === "" ? "—" : String(valor),
    })),
  };
}

function saldoGravado(valor: string) {
  const negativo = valor.trim().startsWith("-");
  const texto = valor.trim().replace(/^-/, "");
  return { texto: texto.length === 5 ? `${texto}:00` : texto, negativo };
}

export class PortalDadosService {
  constructor(
    private readonly db: Pool,
    /** Interno (INTERNO_API_URL + SERVICE_TOKEN): a vaga abre pelo mesmo fluxo da "Nova vaga" de lá. */
    private readonly interno: { url: string; token: string } = { url: "", token: "" },
    private readonly avisar: (mensagem: string, dados?: Record<string, unknown>) => void = () => undefined,
  ) {}

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
          where id_empresa = $1 and status in (0, 3, 4, 5, 9))::text as vagas,
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

  async colaboradores(usuarioId: string, empresaId: string, busca: string, status = "todos") {
    await this.garantir(usuarioId, empresaId);
    const situacao = status === "ativo" || status === "inativo" ? status : "todos";
    const rows = await this.db.query(`
      select nome, email, celular, cargo, departamento, modalidade, contrato, datainicio, situacao, id_candidato
      from (
        select c.nome, c.email, c.celular, v.cargo, col.departamento, m.descricao as modalidade, m.descricao as contrato, cv.datainicio,
               case
                 when col.status_colaborador = 1 then 'Ativo'
                 when cv.status = 2 or nullif(btrim(cv.data_demicao), '') is not null then 'Encerrado'
                 else 'Ativo'
               end as situacao,
               c.id_candidato
        from dna_work.conratacaovaga cv
        join dna_work.candidato c on c.id_candidato = cv.id_candidato
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
        left join lateral (
          select departamento, status_colaborador
          from dna_work.colaborador
          where id_candidato = c.id_candidato
            and id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
          order by case when status_colaborador = 1 then 0 else 1 end, data_cadastro desc nulls last
          limit 1
        ) col on true
        where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
          and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3 or coalesce(col.departamento, '') ilike $3)
        union all
        select c.nome, c.email, c.celular, col.cargo, col.departamento, m.descricao, m.descricao, col.data_inicio,
               case when col.status_colaborador = 1 then 'Ativo' else 'Inativo' end,
               c.id_candidato
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
      where (
        $4 = 'todos'
        or ($4 = 'ativo' and situacao = 'Ativo')
        or ($4 = 'inativo' and situacao <> 'Ativo')
      )
      order by nome
    `, [empresaId, busca, `%${busca}%`, situacao]);
    return rows.rows;
  }

  async colaboradoresPonto(usuarioId: string, empresaId: string, busca: string, status: string) {
    return this.colaboradores(usuarioId, empresaId, busca, status);
  }

  async vagas(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    // A "Nova vaga" grava uma linha por posição com o mesmo comparador: aqui elas viram uma vaga só, por situação.
    const rows = await this.db.query(`
      select (array_agg(v.id_vaga order by v.id_vaga))[1] as id,
             max(coalesce(nullif(btrim(v.codigo::text), ''), v.comparador)) as codigo,
             max(v.cargo) as cargo, sum(coalesce(v.quantidade_posicoes, 1))::int as vagas, v.status,
             max(v.dataabertura) as dataabertura, max(v.salario) as salario,
             max(coalesce(nullif(btrim(v.cidade), ''), e.cidade)) as cidade, max(v.periodo) as periodo,
             max(m.descricao) as contrato,
             bool_or(v.tipo_vaga = 1 and v.escolaridade::text = '31') as aceita_medio
      from dna_work.vaga v
      join dna_work.empresa e on e.id_empresa = v.id_empresa
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where v.id_empresa = $1
        and ($2 = '' or v.cargo ilike $3)
      group by coalesce(nullif(btrim(v.comparador), ''), v.id_vaga), v.status
      order by max(v.dataabertura) desc nulls last
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows.map((row) => ({
      ...row,
      situacao: situacaoVaga(row.status),
    }));
  }

  async contratados(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select cv.id_contratacao as id, c.nome, v.cargo, m.descricao as contrato, cv.datainicio, cv.data_demicao, cv.status,
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
      id: row.id,
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
      select id_feriado as id, nome, data from dna_work.feriados where id_empresa = $1 order by data
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

  /**
   * Abre a vaga no interno (POST /api/v1/servico/vagas), que grava no Lightsail, em public.vaga e em dna_work.vaga
   * como a "Nova vaga" de lá. Sem o interno configurado, ou com a empresa fora do cadastro novo do interno,
   * grava só em dna_work.vaga (aparece em Vagas do interno, mas não na triagem).
   */
  async salvarVaga(usuarioId: string, empresaId: string, body: Record<string, string>, email = "") {
    await this.garantir(usuarioId, empresaId);
    const vaga = validarVaga(body);
    if (this.interno.url && this.interno.token && UUID.test(empresaId)) {
      const resposta = await postServico(this.interno.url, this.interno.token, "/api/v1/servico/vagas", {
        empresa_id: empresaId,
        tipo: vaga.tipo === 1 ? "estagio" : "clt",
        quantidade: vaga.quantidade,
        carga_horaria: vaga.cargaHoraria,
        novo_cargo: { nome: vaga.cargo, descricao: vaga.atividades, requisitos: vaga.requisitos },
        salario: vaga.salario,
        horario_entrada: vaga.entrada,
        horario_saida: vaga.saida,
        ...(vaga.sabado ? { sab_entrada: vaga.sabado.entrada, sab_saida: vaga.sabado.saida } : {}),
        sexo: vaga.sexo,
        idade: vaga.idade,
        idade_ate: vaga.idadeAte,
        atividades: vaga.atividades,
        beneficios: vaga.beneficios ?? undefined,
        ...(vaga.tipo === 1 ? { aceita_ensino_medio: vaga.aceitaMedio } : {}),
        usuario: email,
      });
      const dados = resposta.body?.data as { ids?: string[]; codigo?: string } | undefined;
      if (resposta.status === 201 && dados?.ids?.length) return { id: dados.ids[0], codigo: dados.codigo ?? null, interno: true };
      const codigo = resposta.body?.error?.code;
      if (codigo !== "EMPRESA_FORA_DA_TELA") {
        this.avisar("vaga: interno recusou ou não respondeu", { status: resposta.status, codigo, empresaId });
        if (resposta.status === 422 && resposta.body?.error?.message) throw new AppError(422, "VALIDACAO", resposta.body.error.message);
        throw new AppError(503, "INTERNO_INDISPONIVEL", "Não foi possível abrir a vaga agora. Nada foi gravado; tente de novo em instantes.");
      }
      this.avisar("vaga: empresa fora do cadastro novo do interno, gravando só em dna_work.vaga", { empresaId });
    } else {
      this.avisar("vaga: interno não configurado ou empresa sem UUID, gravando só em dna_work.vaga", { empresaId });
    }
    const id = crypto.randomUUID();
    const texto = vaga.sabado
      ? `Segunda a sexta, ${vaga.entrada} às ${vaga.saida}; sábado, ${vaga.sabado.entrada} às ${vaga.sabado.saida}`
      : `${vaga.entrada} às ${vaga.saida}`;
    await this.db.query(`
      insert into dna_work.vaga
        (id_vaga, id_empresa, cargo, tipo_vaga, salario, status, dataabertura, comparador, quantidade_posicoes,
         texto_carga, horabase, hora_saida_base, carga_horaria, atribuicaoes, requisitos_desejaveis, beneficios_texto,
         sexo, idade, idadeate, escolaridade, sede, publicar, faturar, km, data_adicao)
      values ($1,$2,$3,$4,$5,0,$6,$1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,10,1,'S','30',now())
    `, [
      id, empresaId, vaga.cargo, vaga.tipo, vaga.salario, dataLegado(new Date().toISOString().slice(0, 10)), vaga.quantidade,
      texto, vaga.entrada, vaga.saida, vaga.cargaHoraria, vaga.atividades, vaga.requisitos, vaga.beneficios,
      vaga.sexo, String(vaga.idade), String(vaga.idadeAte), vaga.tipo === 1 && vaga.aceitaMedio ? ESCOLARIDADE_ENSINO_MEDIO : null,
    ]);
    return { id, codigo: null, interno: false };
  }

  async relatorioPonto(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select c.id_candidato, c.nome,
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

  async relatorioPontoColaborador(usuarioId: string, empresaId: string, idCandidato: string, de?: string, ate?: string) {
    await this.garantir(usuarioId, empresaId);
    const pessoa = await this.db.query<{
      id_colaborador: string; nome: string | null; cargo: string | null; banco_horas: string | null;
    }>(`
      select col.id_colaborador, c.nome, coalesce(nullif(btrim(col.cargo), ''), v.cargo) as cargo, col.banco_horas::text
      from dna_work.colaborador col
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      left join lateral (
        select v.cargo
        from dna_work.conratacaovaga cv
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        where cv.id_candidato = c.id_candidato
          and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = col.id_empresa
        order by cv.data_contratacao desc nulls last
        limit 1
      ) v on true
      where col.id_candidato = $1 and col.id_empresa = $2
      order by case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last
      limit 1
    `, [idCandidato, empresaId]);
    const colaborador = pessoa.rows[0];
    if (!colaborador) {
      const contrato = await this.db.query<{ nome: string | null; cargo: string | null }>(`
        select c.nome, v.cargo
        from dna_work.candidato c
        left join dna_work.conratacaovaga cv on cv.id_candidato = c.id_candidato
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        where c.id_candidato = $1
          and (
            exists (select 1 from dna_work.colaborador col where col.id_candidato = c.id_candidato and col.id_empresa = $2)
            or coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $2
            or c.id_empresa = $2
          )
        limit 1
      `, [idCandidato, empresaId]);
      const linha = contrato.rows[0];
      if (!linha) throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado nesta empresa.");
      return { nome: linha.nome ?? "", cargo: linha.cargo ?? "", bancoHoras: false, semRegistro: true, de: de ?? "", ate: ate ?? "", dias: [] as never[] };
    }

    let fim = dataValida(ate) ?? dataSp(0);
    let inicio = dataValida(de) ?? dataSp(-6);
    if (!dataValida(de) && !dataValida(ate)) {
      const ultimo = await this.db.query<{ data: string | null }>(`
        select max(data) as data from dna_work.banco_horas
        where id_colaborador = $1 and data ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$'
      `, [colaborador.id_colaborador]);
      const registrada = ultimo.rows[0]?.data?.replaceAll("/", "-");
      if (registrada && registrada < inicio) {
        fim = registrada;
        inicio = dataSpDe(registrada, -6);
      }
    }
    const dias = intervalo(inicio, fim);
    const chaves = dias.map((dia) => dia.replaceAll("-", "/"));
    const [banco, pontos, escala, feriados, marcados, cargas] = await Promise.all([
      this.db.query<{ data: string; horas_trabalhadas: string | null; saldo_dia: string | null; saldo_bh: string | null; folga: number | null; carga_horaria: number | null }>(`
        select data, horas_trabalhadas, saldo_dia, saldo_bh, folga, carga_horaria
        from dna_work.banco_horas
        where id_colaborador = $1 and data = any($2::text[])
      `, [colaborador.id_colaborador, chaves]),
      this.db.query<{ data: string; entrada: string | null; saida: string | null; horas: string | null }>(`
        select data,
               coalesce(nullif(btrim(entrada_editado), ''), entrada) as entrada,
               coalesce(nullif(btrim(saida_editado), ''), saida) as saida,
               horas_trabalhadas as horas
        from dna_work.tabela_ponto
        where id_colaborador = $1 and data = any($2::text[]) and coalesce(excluido, 0) = 0
        order by data, id
      `, [colaborador.id_colaborador, chaves]),
      this.db.query<Record<string, string | null>>(`
        select segunda, segunda_carga::text, terca, terca_carga::text, quarta, quarta_carga::text,
               quinta, quinta_carga::text, sexta, sexta_carga::text, sabado, sabado_carga::text, domingo, domingo_carga::text
        from dna_work.carga_horaria where id_colaborador = $1 limit 1
      `, [colaborador.id_colaborador]),
      this.db.query<{ data: string }>(`select data from dna_work.feriados where id_empresa = $1 and data = any($2::text[])`, [empresaId, chaves]),
      this.db.query<{ data: string; id_carga_horaria: string | null; id_escala: string | null }>(`
        select replace(data, '-', '/') as data, id_carga_horaria::text, id_escala::text
        from dna_work.ponto_data_trabalho
        where id_colaborador = $1 and replace(data, '-', '/') = any($2::text[])
      `, [colaborador.id_colaborador, chaves]),
      this.db.query<{ id: number; entrada: string | null; saida_refeicao: string | null; retorno_refeicao: string | null; saida: string | null }>(`
        select id, entrada, saida_refeicao, retorno_refeicao, saida from dna_work.ponto_carga_base where id_empresa = $1
      `, [empresaId]),
    ]);
    const porBanco = new Map(banco.rows.map((linha) => [linha.data, linha]));
    const porPonto = new Map<string, Array<{ entrada: string | null; saida: string | null; horas: string | null }>>();
    for (const ponto of pontos.rows) {
      const lista = porPonto.get(ponto.data) ?? [];
      lista.push(ponto);
      porPonto.set(ponto.data, lista);
    }
    const porMarca = new Map(marcados.rows.map((linha) => [linha.data, linha]));
    const porCarga = new Map(cargas.rows.map((linha) => [String(linha.id), linha]));
    const feriado = new Set(feriados.rows.map((linha) => linha.data));
    const semana = escala.rows[0];
    const usaBanco = colaborador.banco_horas === "1";
    const nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
    const campos = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

    const linhas = dias.map((iso) => {
      const chave = iso.replaceAll("-", "/");
      const indice = new Date(`${iso}T12:00:00Z`).getUTCDay();
      const batidas = porPonto.get(chave) ?? [];
      const hora = porBanco.get(chave);
      const marca = porMarca.get(chave);
      const campo = campos[indice];
      const trabalha = marca
        ? marca.id_escala === "1"
        : semana?.[campo] === "1";
      const idCarga = marca?.id_carga_horaria || (trabalha ? semana?.[`${campo}_carga`] : null) || (hora?.carga_horaria ? String(hora.carga_horaria) : null);
      const carga = idCarga && idCarga !== "0" ? porCarga.get(idCarga) : undefined;
      const minutosCarga = feriado.has(chave) || !trabalha ? 0 : minutosDaCarga(carga);
      const minutosFeitos = minutosTrabalhados(batidas, hora?.horas_trabalhadas);
      const primeira = batidas[0];
      const segundaBatida = batidas[1];
      let situacao = "";
      if (!primeira?.entrada) {
        if (feriado.has(chave)) situacao = "Feriado";
        else if (!trabalha || hora?.folga === 1) situacao = "Folga";
        else situacao = usaBanco ? "Banco de Horas" : "Faltou";
      }
      const saldo = hora?.saldo_dia ? saldoGravado(hora.saldo_dia) : { texto: relogio(Math.abs(minutosCarga - minutosFeitos)), negativo: minutosFeitos < minutosCarga };
      return {
        data: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`,
        dia: nomes[indice],
        situacao,
        entrada1: primeira?.entrada ?? "",
        saida1: primeira?.saida ?? "",
        entrada2: segundaBatida?.entrada ?? "",
        saida2: segundaBatida?.saida ?? "",
        total: relogio(minutosFeitos),
        carga: relogio(minutosCarga),
        saldo: saldo.texto,
        saldoNegativo: saldo.negativo && saldo.texto !== "00:00:00",
        banco: hora?.saldo_bh ?? "",
        bancoNegativo: Boolean(hora?.saldo_bh?.startsWith("-")),
      };
    });
    return {
      nome: colaborador.nome ?? "",
      cargo: colaborador.cargo ?? "",
      bancoHoras: usaBanco,
      semRegistro: false,
      de: inicio,
      ate: fim,
      dias: linhas,
    };
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
      select id_candidato as id, nome, cpf, email, celular, bairro, cidade, estado, curso, modalidadecurso as ensino, datacadastro
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
      select e.id_emcaminhamento as id, c.nome, v.cargo, e.data, e.data_entrevista, e.hora,
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
      select g.id_contratogerado as id, c.nome, g.nome_contrato as documentos, g.datainicio as inicio,
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
      select g.id_contratogerado as id, c.nome, v.cargo, g.datainicio as inicio, g.datafim as fim, c.cpf
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
      select d.id, coalesce(nullif(btrim(d.title), ''), v.cargo) as nome, v.cargo, d.data, d.inicio as hora, d.termino, d.link
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
      select a.id, c.nome, a.ciclo, a.area, a.data,
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
      select h.id, h.nome_candidato as nome, h.cargo, h.copentencia as competencia, h.salario_brudo as bruto,
             coalesce(h.saldo_salario, h.total_vencimentos) as liquido
      from dna_work.holerite h
      join dna_work.vaga v on v.id_vaga = h.id_vaga
      where v.id_empresa = $1
      order by h.copentencia desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async detalhe(usuarioId: string, empresaId: string, tipo: string, id: string) {
    await this.garantir(usuarioId, empresaId);
    const ficha = await this.montarDetalhe(empresaId, tipo, id);
    if (!ficha) throw new AppError(404, "REGISTRO_NAO_ENCONTRADO", "Registro não encontrado nesta empresa.");
    return ficha;
  }

  private async montarDetalhe(empresaId: string, tipo: string, id: string) {
    if (tipo === "colaborador") return this.detalheColaborador(empresaId, id);
    if (tipo === "contratado") return this.detalheContratado(empresaId, id);
    if (tipo === "vaga") return this.detalheVaga(empresaId, id);
    if (tipo === "talento") return this.detalheTalento(empresaId, id);
    if (tipo === "escala") return this.detalheEscala(empresaId, id);
    if (tipo === "carga") return this.detalheCarga(empresaId, id);
    if (tipo === "feriado") return this.detalheFeriado(empresaId, id);
    if (tipo === "usuario") return this.detalheUsuario(empresaId, id);
    if (tipo === "holerite") return this.detalheHolerite(empresaId, id);
    if (tipo === "fatura") return this.detalheFatura(empresaId, id);
    if (tipo === "encaminhamento") return this.detalheEncaminhamento(empresaId, id);
    if (tipo === "documento" || tipo === "seguro") return this.detalheContrato(empresaId, id, tipo);
    if (tipo === "calendario") return this.detalheCalendario(empresaId, id);
    if (tipo === "avaliacao") return this.detalheAvaliacao(empresaId, id);
    return null;
  }

  private async detalheColaborador(empresaId: string, id: string) {
    const pessoa = await this.db.query(`
      select c.nome, c.nomesocial, c.cpf, c.datanascimento, c.email, c.celular, c.telefonefixo,
             c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado, c.cep,
             col.cargo, col.departamento, col.data_inicio, col.salario, col.banco_horas, col.id_colaborador,
             case when col.status_colaborador = 1 then 'Ativo' else 'Inativo' end as situacao,
             m.descricao as modalidade
      from dna_work.candidato c
      join dna_work.colaborador col on col.id_candidato = c.id_candidato and col.id_empresa = $2
      left join dna_work.modalidade_vaga m on m.id::text = col.tipo_vaga::text
      where c.id_candidato = $1
      order by case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last
      limit 1
    `, [id, empresaId]);
    const linha = pessoa.rows[0] ?? await this.pessoaDaContratacao(empresaId, id);
    if (!linha) return null;
    const banco = linha.id_colaborador ? await this.saldoBanco(String(linha.id_colaborador)) : null;
    return ficha(linha.nome, linha.cargo, [
      ["Nome", linha.nome], ["Nome social", linha.nomesocial], ["CPF", linha.cpf], ["Nascimento", linha.datanascimento],
      ["E-mail", linha.email], ["Celular", linha.celular], ["Telefone", linha.telefonefixo],
      ["Endereço", [linha.logradouro, linha.numero, linha.complemento].filter(Boolean).join(", ")],
      ["Bairro", linha.bairro], ["Cidade", linha.cidade], ["Estado", linha.estado], ["CEP", linha.cep],
      ["Cargo", linha.cargo], ["Departamento", linha.departamento], ["Modalidade", linha.modalidade],
      ["Início", linha.data_inicio], ["Situação", linha.situacao], ["Salário", dinheiro(linha.salario)],
      ["Banco de horas", linha.banco_horas === "1" || linha.banco_horas === 1 ? "Sim" : "Não"],
      ["Saldo do banco", banco?.saldo ?? null], ["Atualizado em", banco?.data ?? null],
    ]);
  }

  private async pessoaDaContratacao(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, c.nomesocial, c.cpf, c.datanascimento, c.email, c.celular, c.telefonefixo,
             c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado, c.cep,
             v.cargo, col.departamento, cv.datainicio as data_inicio, null::text as salario, col.banco_horas, col.id_colaborador,
             case when cv.status = 2 or nullif(btrim(cv.data_demicao), '') is not null then 'Encerrado' else 'Ativo' end as situacao,
             m.descricao as modalidade
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.colaborador col on col.id_candidato = c.id_candidato
        and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
      left join dna_work.modalidade_vaga m on m.id::text = coalesce(v.tipo_vaga, col.tipo_vaga)::text
      where c.id_candidato = $1
        and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $2
      order by cv.data_contratacao desc nulls last
      limit 1
    `, [id, empresaId]);
    return rows.rows[0];
  }

  private async saldoBanco(idColaborador: string) {
    const rows = await this.db.query<{ saldo: string | null; data: string | null }>(`
      select saldo_bh as saldo, data
      from dna_work.banco_horas
      where id_colaborador = $1 and data ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$'
      order by data desc
      limit 1
    `, [idColaborador]);
    return rows.rows[0];
  }

  private async detalheContratado(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, c.cpf, c.email, c.celular, c.datanascimento, v.cargo, m.descricao as modalidade,
             cv.datainicio, cv.datafim, cv.data_contratacao, cv.data_demicao, cv.status,
             col.departamento, col.salario, col.banco_horas, col.id_colaborador
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
      left join dna_work.colaborador col on col.id_candidato = c.id_candidato
        and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
      where cv.id_contratacao::text = $1
        and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $2
      limit 1
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const banco = linha.id_colaborador ? await this.saldoBanco(String(linha.id_colaborador)) : null;
    return ficha(linha.nome, linha.cargo, [
      ["Nome", linha.nome], ["CPF", linha.cpf], ["Nascimento", linha.datanascimento],
      ["E-mail", linha.email], ["Celular", linha.celular],
      ["Cargo", linha.cargo], ["Departamento", linha.departamento], ["Modalidade", linha.modalidade],
      ["Contratação", linha.data_contratacao], ["Início", linha.datainicio], ["Fim", linha.datafim],
      ["Demissão", linha.data_demicao],
      ["Situação", linha.data_demicao || Number(linha.status) === 2 ? "Encerrado" : "Ativo"],
      ["Salário", dinheiro(linha.salario)],
      ["Banco de horas", linha.banco_horas === "1" || linha.banco_horas === 1 ? "Sim" : "Não"],
      ["Saldo do banco", banco?.saldo ?? null], ["Atualizado em", banco?.data ?? null],
    ]);
  }

  private async detalheVaga(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select coalesce(nullif(btrim(v.codigo::text), ''), v.comparador) as codigo, v.cargo, v.tipo_vaga,
             m.descricao as modalidade, v.salario,
             (select sum(coalesce(irma.quantidade_posicoes, 1))::int from dna_work.vaga irma
               where irma.id_empresa = v.id_empresa and irma.status = v.status
                 and coalesce(nullif(btrim(irma.comparador), ''), irma.id_vaga) = coalesce(nullif(btrim(v.comparador), ''), v.id_vaga)) as quantidade_posicoes,
             coalesce(nullif(btrim(v.cidade), ''), e.cidade) as cidade, v.periodo, v.dataabertura, v.dataencerramento, v.escolaridade::text as escolaridade,
             v.experiencia, v.sexo, v.idade, v.idadeate,
             v.atribuicaoes, coalesce(nullif(btrim(v.beneficios_texto), ''), v.beneficios) as beneficios, v.requisitos_desejaveis, v.carga_horaria, v.jornada, v.texto_carga, v.obs, v.responsavel, v.remoto, v.status
      from dna_work.vaga v
      join dna_work.empresa e on e.id_empresa = v.id_empresa
      left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
      where v.id_vaga = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const estagio = Number(linha.tipo_vaga) === 1;
    const medio = linha.escolaridade === ESCOLARIDADE_ENSINO_MEDIO;
    const carga = linha.carga_horaria && /^\d+$/.test(String(linha.carga_horaria)) ? `${linha.carga_horaria} horas por semana` : linha.carga_horaria;
    const idade = linha.idade && linha.idadeate ? `${linha.idade} a ${linha.idadeate} anos` : linha.idade ? `A partir de ${linha.idade} anos` : null;
    return ficha(linha.cargo, linha.modalidade, [
      ["Código", linha.codigo], ["Cargo", linha.cargo], ["Modalidade", linha.modalidade],
      ["Posições", linha.quantidade_posicoes], [estagio ? "Bolsa-auxílio" : "Salário", dinheiro(linha.salario)], ["Cidade", linha.cidade],
      ["Período", linha.periodo], ["Horário", linha.jornada || linha.texto_carga], ["Carga horária", carga],
      ["Aceita ensino médio", estagio ? (medio ? "Sim" : "Não") : null],
      ["Sexo", linha.sexo === "M" ? "Masculino" : linha.sexo === "F" ? "Feminino" : linha.sexo === "I" ? "Indiferente" : null],
      ["Idade", idade],
      ["Situação", situacaoVaga(linha.status)],
      ["Abertura", linha.dataabertura], ["Encerramento", linha.dataencerramento],
      ["Experiência", linha.experiencia],
      ["Atividades", linha.atribuicaoes], ["Requisitos", linha.requisitos_desejaveis], ["Benefícios", linha.beneficios],
      ["Remoto", linha.remoto === 1 || linha.remoto === "1" ? "Sim" : linha.remoto ? "Não" : null],
      ["Responsável", linha.responsavel], ["Observação", linha.obs],
    ]);
  }

  private async detalheTalento(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome, nomesocial, cpf, datanascimento, email, celular, telefonefixo,
             logradouro, numero, complemento, bairro, cidade, estado, cep,
             modalidadecurso, curso, nome_escola, datacadastro, objetivo, pretencao_salarial
      from dna_work.candidato
      where id_candidato = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.curso, [
      ["Nome", linha.nome], ["Nome social", linha.nomesocial], ["CPF", linha.cpf], ["Nascimento", linha.datanascimento],
      ["E-mail", linha.email], ["Celular", linha.celular], ["Telefone", linha.telefonefixo],
      ["Endereço", [linha.logradouro, linha.numero, linha.complemento].filter(Boolean).join(", ")],
      ["Bairro", linha.bairro], ["Cidade", linha.cidade], ["Estado", linha.estado], ["CEP", linha.cep],
      ["Ensino", linha.modalidadecurso], ["Curso", linha.curso], ["Escola", linha.nome_escola],
      ["Cadastro", linha.datacadastro], ["Objetivo", linha.objetivo], ["Pretensão", dinheiro(linha.pretencao_salarial)],
    ]);
  }

  private async detalheEscala(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome,
             case when segunda_feira::text = '1' then 'Trabalha' else 'Folga' end as segunda,
             case when terca_feira::text = '1' then 'Trabalha' else 'Folga' end as terca,
             case when quarta_feira::text = '1' then 'Trabalha' else 'Folga' end as quarta,
             case when quinta_feira::text = '1' then 'Trabalha' else 'Folga' end as quinta,
             case when sexta_feira::text = '1' then 'Trabalha' else 'Folga' end as sexta,
             case when sabado::text = '1' then 'Trabalha' else 'Folga' end as sabado,
             case when domingo::text = '1' then 'Trabalha' else 'Folga' end as domingo
      from dna_work.ponto_turno_base
      where id::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, "Escala", [
      ["Nome", linha.nome], ["Segunda", linha.segunda], ["Terça", linha.terca], ["Quarta", linha.quarta],
      ["Quinta", linha.quinta], ["Sexta", linha.sexta], ["Sábado", linha.sabado], ["Domingo", linha.domingo],
    ]);
  }

  private async detalheCarga(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome, tipo, entrada, saida_refeicao, retorno_refeicao, saida, tolerancia, pausa
      from dna_work.ponto_carga_base
      where id::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.tipo, [
      ["Nome", linha.nome], ["Tipo", linha.tipo], ["Entrada", linha.entrada],
      ["Saída refeição", linha.saida_refeicao], ["Retorno refeição", linha.retorno_refeicao],
      ["Saída", linha.saida], ["Tolerância", linha.tolerancia],
      ["Pausa", Number(linha.pausa) === 1 ? "Sim" : "Não"],
    ]);
  }

  private async detalheFeriado(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome, data from dna_work.feriados where id_feriado::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.data, [["Nome", linha.nome], ["Data", linha.data]]);
  }

  private async detalheUsuario(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select u.nome_u as nome, u.email_u as email, u.telefone_u as telefone,
             case u.tipo::text when '1' then 'Administrador' when '2' then 'Gerente' when '3' then 'Comercial' when '4' then 'Operador' else u.tipo::text end as tipo,
             case when u.status = 1 then 'Ativo' else 'Inativo' end as situacao
      from dna_work.usuario_empresa u
      where u.id_u = $1
        and (u.empresa_u = $2 or exists (select 1 from dna_work.vinculo_empresa_usuario v where v.id_usuario = u.id_u and v.id_empresa = $2))
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.tipo, [
      ["Nome", linha.nome], ["E-mail", linha.email], ["Telefone", linha.telefone], ["Tipo", linha.tipo], ["Situação", linha.situacao],
    ]);
  }

  private async detalheHolerite(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select h.nome_candidato, h.cpf, h.cargo, h.copentencia, h.data_adimicao, h.diastrabalhados,
             h.salario_brudo, h.total_vencimentos, h.desconto_total, h.saldo_salario,
             h.valor_inss, h.valor_irrf, h.fgts_valor, h.faltas_valor, h.hora_extra_valor, h.adiamtamento_valor,
             h.banco, h.ag, h.cc, h.pix_tipo, h.pix_chave
      from dna_work.holerite h
      join dna_work.vaga v on v.id_vaga = h.id_vaga
      where h.id::text = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome_candidato, linha.copentencia, [
      ["Nome", linha.nome_candidato], ["CPF", linha.cpf], ["Cargo", linha.cargo],
      ["Competência", linha.copentencia], ["Admissão", linha.data_adimicao], ["Dias trabalhados", linha.diastrabalhados],
      ["Salário bruto", dinheiro(linha.salario_brudo)], ["Vencimentos", dinheiro(linha.total_vencimentos)],
      ["Descontos", dinheiro(linha.desconto_total)], ["Líquido", dinheiro(linha.saldo_salario)],
      ["INSS", dinheiro(linha.valor_inss)], ["IRRF", dinheiro(linha.valor_irrf)], ["FGTS", dinheiro(linha.fgts_valor)],
      ["Faltas", dinheiro(linha.faltas_valor)], ["Hora extra", dinheiro(linha.hora_extra_valor)],
      ["Adiantamento", dinheiro(linha.adiamtamento_valor)],
      ["Banco", linha.banco], ["Agência", linha.ag], ["Conta", linha.cc], ["Pix", [linha.pix_tipo, linha.pix_chave].filter(Boolean).join(" ")],
    ]);
  }

  private async detalheFatura(empresaId: string, id: string) {
    const nova = await this.db.query(`
      select descricao, vencimento::text, valor::text, situacao, data_pagamento::text as pagamento, url_pagamento
      from dna_work.cobranca_asaas
      where id::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    if (nova.rows[0]) {
      const linha = nova.rows[0];
      return ficha(linha.descricao || "Fatura", linha.situacao, [
        ["Competência", linha.descricao], ["Vencimento", linha.vencimento], ["Valor", dinheiro(linha.valor)],
        ["Situação", linha.situacao === "paga" ? "Paga" : "Aberta"], ["Pagamento", linha.pagamento], ["Link", linha.url_pagamento],
      ]);
    }
    const antiga = await this.db.query(`
      select mes, ano, vencimento_fatura, valor_inicial, desconto, acressimo, valor_final, status_fatura, data_pg, forma_pg, url_pg
      from dna_work.fatura
      where id_fatura::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = antiga.rows[0];
    if (!linha) return null;
    return ficha(linha.mes && linha.ano ? `${linha.mes}/${linha.ano}` : "Fatura", linha.status_fatura === "0" ? "Aberta" : "Paga", [
      ["Competência", linha.mes && linha.ano ? `${linha.mes}/${linha.ano}` : null],
      ["Vencimento", linha.vencimento_fatura], ["Valor inicial", dinheiro(linha.valor_inicial)],
      ["Desconto", dinheiro(linha.desconto)], ["Acréscimo", dinheiro(linha.acressimo)], ["Valor", dinheiro(linha.valor_final)],
      ["Situação", linha.status_fatura === "0" ? "Aberta" : "Paga"], ["Pagamento", linha.data_pg],
      ["Forma", linha.forma_pg], ["Link", linha.url_pg],
    ]);
  }

  private async detalheEncaminhamento(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, v.cargo, e.data, e.data_entrevista, e.hora, e.endereco, e.compareceu, e.reprovado, e.motivo, e.feed
      from dna_work.emcaminhamento e
      join dna_work.vaga v on v.id_vaga = e.id_vaga
      left join dna_work.candidato c on c.id_candidato = e.id_candidato
      where e.id_emcaminhamento::text = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const situacao = linha.compareceu === "1" ? "Compareceu" : linha.reprovado === "S" ? "Reprovado" : "Encaminhado";
    return ficha(linha.nome, linha.cargo, [
      ["Candidato", linha.nome], ["Vaga", linha.cargo], ["Convocação", linha.data],
      ["Entrevista", linha.data_entrevista], ["Hora", linha.hora], ["Endereço", linha.endereco],
      ["Situação", situacao], ["Motivo", linha.motivo], ["Retorno", linha.feed],
    ]);
  }

  private async detalheContrato(empresaId: string, id: string, tipo: string) {
    const rows = await this.db.query(`
      select c.nome, c.cpf, v.cargo, g.nome_contrato, g.datainicio, g.datafim, g.datadevolucao, g.devolvido, g.data
      from dna_work.contratos_gerados g
      left join dna_work.candidato c on c.id_candidato = g.id_candidato
      left join dna_work.vaga v on v.id_vaga::text = g.vaga::text
      where g.id_contratogerado::text = $1 and g.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const campos: Array<[string, unknown]> = [
      ["Nome", linha.nome], ["CPF", linha.cpf], ["Cargo", linha.cargo], ["Contrato", linha.nome_contrato],
      ["Início", linha.datainicio], ["Fim", linha.datafim], ["Gerado em", linha.data],
    ];
    if (tipo === "documento") {
      campos.push(["Devolução", linha.datadevolucao], ["Situação", ["1", "S", "s"].includes(String(linha.devolvido)) ? "Devolvido" : "Pendente"]);
    }
    return ficha(linha.nome, tipo === "seguro" ? "Seguro de vida" : linha.nome_contrato, campos);
  }

  private async detalheCalendario(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select coalesce(nullif(btrim(d.title), ''), v.cargo) as nome, v.cargo, d.data, d.inicio, d.termino, d.endereco, d.link, d.tipo
      from dna_work.entrevista_datas d
      join dna_work.vaga v on v.comparador::text = d.comparador::text
      where d.id::text = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.cargo, [
      ["Compromisso", linha.nome], ["Vaga", linha.cargo], ["Data", linha.data], ["Início", linha.inicio],
      ["Término", linha.termino], ["Endereço", linha.endereco], ["Link", linha.link], ["Tipo", linha.tipo],
    ]);
  }

  private async detalheAvaliacao(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, a.ciclo, a.area, a.sub_area, a.dimensao, a.nivel, a.data,
             a.respondido_empresa, a.respondido_colaborador, a.completou_ciclo
      from dna_work.avaliacao_desepenho a
      join dna_work.colaborador col on col.id_colaborador = a.id_colaborador
      left join dna_work.candidato c on c.id_candidato = col.id_candidato
      where a.id::text = $1 and col.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.ciclo, [
      ["Colaborador", linha.nome], ["Ciclo", linha.ciclo], ["Área", linha.area], ["Subárea", linha.sub_area],
      ["Dimensão", linha.dimensao], ["Nível", linha.nivel], ["Data", linha.data],
      ["Resposta da empresa", linha.respondido_empresa], ["Resposta do colaborador", linha.respondido_colaborador],
      ["Situação", linha.completou_ciclo === "1" ? "Concluída" : "Em aberto"],
    ]);
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
