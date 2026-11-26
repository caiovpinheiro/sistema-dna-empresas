import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";

/**
 * Permissões que a empresa dá a um colaborador para ele cuidar do ponto de outros colaboradores, pelo próprio app do
 * ponto (o login da empresa é um só e não é dividido com ninguém).
 * - ver: espelho, relatórios e saldo.
 * - solicitacoes: aprovar ou recusar pedidos de ajuste e de inclusão (nunca os dele mesmo).
 * - cadastro: cadastrar, trocar a jornada, redefinir a senha do ponto, desligar e reativar.
 * - empresa: férias/recesso dos escolhidos, jornadas e feriados (jornadas e feriados valem para a empresa toda).
 * Todas valem só para os colaboradores escolhidos (ou para todos, inclusive os que entrarem depois).
 * Só a empresa (o login do portal) mexe nas permissões.
 */
export const PERMISSOES = ["ver", "solicitacoes", "cadastro", "empresa"] as const;
export type Permissao = (typeof PERMISSOES)[number];
/** Permissões que se escolhem por colaborador. */
export const POR_COLABORADOR: Permissao[] = ["ver", "solicitacoes", "cadastro", "empresa"];

export type Acesso = {
  limitado: boolean;
  /** id_candidato de quem está usando (colaborador com permissões); vazio para a empresa. */
  eu: string;
  permissoes: Map<Permissao, { todos: boolean; ids: Set<string> }>;
};

/** A empresa (login do portal): vê e faz tudo. */
export const EMPRESA: Acesso = { limitado: false, eu: "", permissoes: new Map() };

/** Quem está usando a gestão do ponto pelo app do colaborador. */
export type Gestor = { idCandidato: string; empresaId: string; usuarioEmpresa: string; acesso: Acesso };

export class PermissoesPontoService {
  constructor(private readonly db: Pool) {}

  async acesso(idGestor: string, empresaId: string): Promise<Acesso> {
    const [permissoes, pessoas] = await Promise.all([
      this.db.query<{ permissao: Permissao; todos: boolean }>(
        "select permissao, todos from dna_work.ponto_permissao_gestor where id_gestor = $1 and id_empresa = $2",
        [idGestor, empresaId],
      ),
      this.db.query<{ permissao: Permissao; id_candidato: string }>(
        "select permissao, id_candidato from dna_work.ponto_permissao_gestor_pessoa where id_gestor = $1 and id_empresa = $2",
        [idGestor, empresaId],
      ),
    ]);
    const mapa = new Map<Permissao, { todos: boolean; ids: Set<string> }>();
    for (const linha of permissoes.rows) {
      if (!PERMISSOES.includes(linha.permissao)) continue;
      mapa.set(linha.permissao, { todos: linha.todos, ids: new Set(pessoas.rows.filter((p) => p.permissao === linha.permissao).map((p) => p.id_candidato)) });
    }
    return { limitado: true, eu: idGestor, permissoes: mapa };
  }

  /**
   * Colaborador logado no app do ponto: de que empresa ele é, que permissões tem e qual é o login da empresa (as funções
   * do portal conferem a empresa por ele). Desligado não tem permissão nenhuma.
   */
  async gestor(idColaborador: string): Promise<Gestor | null> {
    const linha = (await this.db.query<{ id_candidato: string; id_empresa: string }>(`
      select col.id_candidato, col.id_empresa from dna_work.colaborador col
      where col.id_colaborador = $1 and coalesce(col.status_colaborador, 1) = 1
    `, [idColaborador])).rows[0];
    if (!linha) return null;
    const acesso = await this.acesso(linha.id_candidato, linha.id_empresa);
    const usuario = (await this.db.query<{ id: string }>(`
      select id_u as id from dna_work.usuario_empresa where empresa_u = $1 and status = 1
      union
      select v.id_usuario from dna_work.vinculo_empresa_usuario v where v.id_empresa = $1
      limit 1
    `, [linha.id_empresa])).rows[0];
    return { idCandidato: linha.id_candidato, empresaId: linha.id_empresa, usuarioEmpresa: usuario?.id ?? "", acesso };
  }

  /** Para a tela: quais permissões tem (sem a lista de pessoas). */
  static resumo(acesso: Acesso) {
    return { limitado: acesso.limitado, permissoes: acesso.limitado ? [...acesso.permissoes.keys()] : [...PERMISSOES] };
  }

  static tem(acesso: Acesso, permissao: Permissao) {
    return !acesso.limitado || acesso.permissoes.has(permissao);
  }

  /** null = todos; senão, os id_candidato liberados. */
  static alcance(acesso: Acesso, permissao: Permissao): Set<string> | null {
    if (!acesso.limitado) return null;
    const regra = acesso.permissoes.get(permissao);
    if (!regra) return new Set();
    return regra.todos ? null : regra.ids;
  }

  /** Junta o alcance de várias permissões (quem pode ver por qualquer uma delas). */
  static alcanceDeQualquer(acesso: Acesso, permissoes: Permissao[]): Set<string> | null {
    if (!acesso.limitado) return null;
    const juntos = new Set<string>();
    for (const permissao of permissoes) {
      const alcance = PermissoesPontoService.alcance(acesso, permissao);
      if (alcance === null && acesso.permissoes.has(permissao)) return null;
      for (const id of alcance ?? []) juntos.add(id);
    }
    return juntos;
  }

  static exigir(acesso: Acesso, permissao: Permissao, idCandidato?: string | null) {
    if (!acesso.limitado) return;
    const regra = acesso.permissoes.get(permissao);
    if (!regra) throw new AppError(403, "SEM_PERMISSAO", "Você não tem permissão para isso. Fale com a empresa.");
    // Mesmo erro para "não pode" e "não existe": quem não tem acesso ao colaborador não descobre que ele existe.
    if (idCandidato !== undefined && !regra.todos && !regra.ids.has(String(idCandidato ?? ""))) {
      throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado.");
    }
  }

  /** Ninguém aprova o próprio pedido de ajuste: o ponto dele é tratado pela empresa ou por outra pessoa. */
  static naoEhOProprio(acesso: Acesso, idCandidato: string | null) {
    if (acesso.limitado && idCandidato && idCandidato === acesso.eu) {
      throw new AppError(403, "PROPRIO_PEDIDO", "Você não pode responder o seu próprio pedido. Ele vai para a empresa.");
    }
  }

  async candidatoDoAjuste(idJustificativa: number, empresaId: string) {
    const linha = await this.db.query<{ id_candidato: string }>(`
      select col.id_candidato from dna_work.justificativa j
      join dna_work.tabela_ponto t on t.id = j.id_ponto
      join dna_work.colaborador col on col.id_colaborador = t.id_colaborador
      where j.id = $1 and col.id_empresa = $2
    `, [idJustificativa, empresaId]);
    return linha.rows[0]?.id_candidato ?? null;
  }

  async candidatoDaInclusao(idInclusao: number, empresaId: string) {
    const linha = await this.db.query<{ id_candidato: string }>(`
      select col.id_candidato from dna_work.ponto_inclusao i
      join dna_work.colaborador col on col.id_colaborador = i.id_colaborador
      where i.id = $1 and col.id_empresa = $2
    `, [idInclusao, empresaId]);
    return linha.rows[0]?.id_candidato ?? null;
  }

  async candidatoDoColaborador(idColaborador: string) {
    const linha = await this.db.query<{ id_candidato: string }>("select id_candidato from dna_work.colaborador where id_colaborador = $1", [idColaborador]);
    return linha.rows[0]?.id_candidato ?? null;
  }

  /** Quem cadastrou um colaborador passa a enxergá-lo nas permissões que têm lista de pessoas. */
  async incluirNoAlcance(empresaId: string, acesso: Acesso, idCandidato: string) {
    if (!acesso.limitado) return;
    for (const permissao of POR_COLABORADOR) {
      const regra = acesso.permissoes.get(permissao);
      if (!regra || regra.todos) continue;
      await this.db.query(`
        insert into dna_work.ponto_permissao_gestor_pessoa (id_gestor, id_empresa, permissao, id_candidato)
        values ($1, $2, $3, $4) on conflict do nothing
      `, [acesso.eu, empresaId, permissao, idCandidato]);
    }
  }

  /** Abas da gestão do ponto no app do colaborador: só o que as permissões liberam. */
  static abas(acesso: Acesso) {
    const abas: Array<{ id: string; label: string; link: string }> = [];
    if (["ver", "cadastro", "empresa"].some((p) => PermissoesPontoService.tem(acesso, p as Permissao))) abas.push({ id: "colaboradores", label: "Colaboradores", link: "/ponto/colaboradores" });
    if (PermissoesPontoService.tem(acesso, "solicitacoes")) abas.push({ id: "solicitacoes", label: "Solicitações", link: "/ponto/solicitacoes" });
    if (PermissoesPontoService.tem(acesso, "ver")) abas.push({ id: "relatorio", label: "Relatório", link: "/ponto/relatorio" });
    if (PermissoesPontoService.tem(acesso, "empresa")) {
      abas.push({ id: "jornadas", label: "Jornadas", link: "/jornadas" });
      abas.push({ id: "feriados", label: "Feriados", link: "/feriados" });
    }
    return abas;
  }

  // ---- Tela da empresa ----

  private async colaboradoresDaEmpresa(empresaId: string) {
    const linhas = await this.db.query<{ id_candidato: string; nome: string; cargo: string | null; departamento: string | null; ativo: boolean }>(`
      select distinct on (col.id_candidato) col.id_candidato, c.nome, nullif(btrim(col.cargo), '') as cargo,
             nullif(btrim(col.departamento), '') as departamento, coalesce(col.status_colaborador, 1) = 1 as ativo
      from dna_work.colaborador col
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_empresa = $1
      order by col.id_candidato, case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last
    `, [empresaId]);
    return linhas.rows.sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  }

  /** Lista para a empresa escolher a quem dar permissões (só quem está ativo): mostra quais cada um já tem. */
  async lista(empresaId: string) {
    const [colaboradores, permissoes] = await Promise.all([
      this.colaboradoresDaEmpresa(empresaId).then((linhas) => linhas.filter((linha) => linha.ativo)),
      this.db.query<{ id_gestor: string; permissao: Permissao }>("select id_gestor, permissao from dna_work.ponto_permissao_gestor where id_empresa = $1", [empresaId]),
    ]);
    return colaboradores.map((linha) => ({
      ...linha,
      permissoes: PERMISSOES.filter((permissao) => permissoes.rows.some((p) => p.id_gestor === linha.id_candidato && p.permissao === permissao)),
    }));
  }

  /** Configuração de um colaborador e a lista dos outros para escolher. */
  async configuracao(empresaId: string, idGestor: string) {
    const colaboradores = await this.colaboradoresDaEmpresa(empresaId);
    const gestor = colaboradores.find((linha) => linha.id_candidato === idGestor);
    if (!gestor) throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado.");
    const acesso = await this.acesso(idGestor, empresaId);
    // Para escolher, só quem está ativo (desligado não aparece; ao salvar, sai da lista de quem foi escolhido).
    const escolhiveis = colaboradores.filter((linha) => linha.ativo && linha.id_candidato !== idGestor);
    const ativos = new Set(escolhiveis.map((linha) => linha.id_candidato));
    return {
      colaborador: gestor,
      permissoes: Object.fromEntries(PERMISSOES.map((permissao) => {
        const regra = acesso.permissoes.get(permissao);
        return [permissao, { ativa: Boolean(regra), todos: regra?.todos ?? false, ids: [...(regra?.ids ?? [])].filter((id) => ativos.has(id)) }];
      })),
      colaboradores: escolhiveis,
    };
  }

  async salvar(empresaId: string, idGestor: string, body: unknown) {
    const atual = await this.configuracao(empresaId, idGestor);
    if (!atual.colaborador.ativo) throw new AppError(409, "COLABORADOR_DESLIGADO", "Colaborador desligado não recebe permissões do ponto.");
    const dados = (body ?? {}) as { permissoes?: Record<string, { ativa?: unknown; todos?: unknown; ids?: unknown }> };
    const validos = new Set(atual.colaboradores.map((linha) => linha.id_candidato));
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("delete from dna_work.ponto_permissao_gestor_pessoa where id_gestor = $1 and id_empresa = $2", [idGestor, empresaId]);
      await client.query("delete from dna_work.ponto_permissao_gestor where id_gestor = $1 and id_empresa = $2", [idGestor, empresaId]);
      for (const permissao of PERMISSOES) {
        const regra = dados.permissoes?.[permissao];
        if (!regra || regra.ativa !== true) continue;
        const todos = !POR_COLABORADOR.includes(permissao) || regra.todos === true;
        await client.query(`
          insert into dna_work.ponto_permissao_gestor (id_gestor, id_empresa, permissao, todos) values ($1, $2, $3, $4)
        `, [idGestor, empresaId, permissao, todos]);
        if (todos) continue;
        const ids = Array.isArray(regra.ids) ? [...new Set(regra.ids.map(String))].filter((id) => validos.has(id)) : [];
        if (ids.length) {
          await client.query(`
            insert into dna_work.ponto_permissao_gestor_pessoa (id_gestor, id_empresa, permissao, id_candidato)
            select $1, $2, $3, unnest($4::varchar[])
          `, [idGestor, empresaId, permissao, ids]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.configuracao(empresaId, idGestor);
  }
}
