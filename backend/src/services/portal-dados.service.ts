import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";

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

  private async garantir(usuarioId: string, empresaId: string) {
    const acesso = await this.db.query(`
      select 1 from dna_work.usuario_empresa where id_u = $1 and empresa_u = $2 and status = 1
      union
      select 1 from dna_work.vinculo_empresa_usuario where id_usuario = $1 and id_empresa = $2
    `, [usuarioId, empresaId]);
    if (!acesso.rowCount) throw new AppError(403, "EMPRESA_NEGADA", "Esta empresa não está vinculada ao usuário.");
  }
}
