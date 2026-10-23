import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";

export type EmpresaResumo = { id: string; nome: string };

export type SessaoEmpresa = {
  id: string;
  nome: string;
  email: string;
  empresaId: string;
  empresas: EmpresaResumo[];
  mustChangePassword: boolean;
};

export type ItemMenu = {
  id: string;
  label: string;
  link: string | null;
  children: ItemMenu[];
};

type UsuarioRow = {
  id_u: string;
  nome_u: string;
  email_u: string;
  senha_u: string | null;
  senha_hash: string | null;
  empresa_u: string | null;
  data_senha: string | null;
  atualiza_senha: number | null;
};

const userSelect = `
  select id_u, nome_u, email_u, senha_u, senha_hash, empresa_u, data_senha, atualiza_senha
  from dna_work.usuario_empresa
`;

export class PortalEmpresaService {
  constructor(private readonly db: Pool) {}

  async login(email: string, password: string): Promise<SessaoEmpresa> {
    const usuarios = await this.buscarPorEmail(email);
    for (const usuario of usuarios) {
      if (await this.senhaConfere(usuario, password)) {
        if (!(await this.argonConfere(usuario.senha_hash, password))) {
          await this.guardarHash(usuario.id_u, password);
        }
        return this.montarSessao(usuario, null);
      }
    }
    throw new AppError(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha inválidos.");
  }

  async sessao(usuarioId: string, empresaId: string): Promise<SessaoEmpresa> {
    const usuario = await this.buscarPorId(usuarioId);
    return this.montarSessao(usuario, empresaId);
  }

  async trocarEmpresa(usuarioId: string, empresaId: string): Promise<SessaoEmpresa> {
    const usuario = await this.buscarPorId(usuarioId);
    const sessao = await this.montarSessao(usuario, empresaId);
    if (!sessao.empresas.some((empresa) => empresa.id === empresaId)) {
      throw new AppError(403, "EMPRESA_NEGADA", "Esta empresa não está vinculada ao usuário.");
    }
    return { ...sessao, empresaId };
  }

  async trocarSenha(usuarioId: string, password: string): Promise<void> {
    if (password.length < 6) {
      throw new AppError(422, "SENHA_CURTA", "A senha precisa ter pelo menos 6 caracteres.");
    }
    const senhaHash = await hash(password);
    const senhaLegada = createHash("md5").update(password).digest("hex");
    try {
      await this.db.query(
        `update dna_work.usuario_empresa
         set senha_hash = $2, senha_u = $3, atualiza_senha = 0, data_senha = to_char(current_date, 'YYYY/MM/DD')
         where id_u = $1`,
        [usuarioId, senhaHash, senhaLegada],
      );
    } catch (error) {
      if (codigoPg(error) === "42703") {
        throw new AppError(503, "MIGRACAO_PENDENTE", "Falta a coluna de senha do portal. Aplique as migrations e tente de novo.");
      }
      throw error;
    }
  }

  async menu(usuarioId: string, empresaId: string): Promise<ItemMenu[]> {
    const sessao = await this.sessao(usuarioId, empresaId);
    if (sessao.mustChangePassword) {
      throw new AppError(403, "SENHA_EXPIRADA", "Atualize a senha para continuar.");
    }
    if (!sessao.empresas.some((empresa) => empresa.id === empresaId)) {
      throw new AppError(403, "EMPRESA_NEGADA", "Esta empresa não está vinculada ao usuário.");
    }

    const permissoes = await this.db.query<{ menu: string | null; sub1: string | null; sub2: string | null }>(
      `select menu, sub1, sub2 from dna_work.paginas_usuario_empresa where id_usuario = $1`,
      [usuarioId],
    );
    const ultima = permissoes.rows.at(-1);
    const menuIds = idsDe(ultima?.menu);
    const sub1Ids = idsDe(ultima?.sub1);
    const sub2Ids = idsDe(ultima?.sub2);
    if (!menuIds.size) return [];

    const empresa = await this.db.query<{ recrutamento: number | null; ponto: number | null; desepenho: string | null }>(
      `select recrutamento, ponto, desepenho from dna_work.empresa where id_empresa = $1`,
      [empresaId],
    );
    const atual = empresa.rows[0];
    if (!atual) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const modulos = [0];
    if (Number(atual.recrutamento) === 1) modulos.push(1);
    if (Number(atual.ponto) === 1) modulos.push(2);
    if (String(atual.desepenho ?? "") === "1") modulos.push(3);

    const itens = await this.db.query<{ id_item: number; descricao: string | null; tipo: number; ordem: number; link: string | null }>(
      `select id_item, descricao, tipo, ordem, link
       from dna_work.item_menu_empresa
       where modulo = any($1::int[])
       order by ordem, id_item`,
      [modulos],
    );
    const visiveis = itens.rows.filter((item) => menuIds.has(String(item.id_item)) && item.descricao);
    if (!visiveis.length) return [];

    const submenu1 = await this.db.query<{
      id_submenu: number; menu: number; descricao: string | null; tipo: number; link: string | null;
    }>(
      `select id_submenu, menu, descricao, tipo, link
       from dna_work.submenu1_empresa
       where menu = any($1::int[]) and modulo = any($2::int[]) and tipo in (1, 2)
       order by ordem, id_submenu`,
      [visiveis.map((item) => item.id_item), modulos],
    );
    const grupos = submenu1.rows.filter((item) => sub1Ids.has(String(item.id_submenu)) && item.descricao);
    const pais = grupos.filter((item) => Number(item.tipo) === 2).map((item) => item.id_submenu);
    type FolhaMenu = { id_submenu2: number; id_submenu1: number; descricao: string | null; link: string | null };
    const submenu2 = pais.length
      ? await this.db.query<FolhaMenu>(
        `select id_submenu2, id_submenu1, descricao, link
         from dna_work.submenu2_empresa
         where id_submenu1 = any($1::int[]) and modulo = any($2::int[])
         order by ordem, id_submenu2`,
        [pais, modulos],
      )
      : { rows: [] as FolhaMenu[] };

    const menu: ItemMenu[] = [];
    for (const item of visiveis) {
      if (Number(item.tipo) === 2) {
        menu.push({ id: `m${item.id_item}`, label: item.descricao!.trim(), link: linkUtil(item.link), children: [] });
        continue;
      }
      if (Number(item.tipo) !== 1) continue;
      const children: ItemMenu[] = [];
      for (const sub of grupos.filter((grupo) => grupo.menu === item.id_item)) {
        if (Number(sub.tipo) === 1) {
          children.push({ id: `s${sub.id_submenu}`, label: sub.descricao!.trim(), link: linkUtil(sub.link), children: [] });
          continue;
        }
        const folhas = submenu2.rows
          .filter((folha) => folha.id_submenu1 === sub.id_submenu && sub2Ids.has(String(folha.id_submenu2)) && folha.descricao)
          .map((folha) => ({
            id: `s2${folha.id_submenu2}`,
            label: folha.descricao!.trim(),
            link: linkUtil(folha.link),
            children: [] as ItemMenu[],
          }));
        if (folhas.length) {
          children.push({ id: `s${sub.id_submenu}`, label: sub.descricao!.trim(), link: null, children: folhas });
        }
      }
      if (children.length) {
        menu.push({ id: `m${item.id_item}`, label: item.descricao!.trim(), link: null, children });
      }
    }
    return menu;
  }

  private async montarSessao(usuario: UsuarioRow, empresaPreferida: string | null): Promise<SessaoEmpresa> {
    const empresas = await this.empresasDoUsuario(usuario);
    if (!empresas.length) {
      throw new AppError(403, "SEM_EMPRESA", "Usuário sem empresa vinculada.");
    }
    const empresaId = empresas.some((empresa) => empresa.id === empresaPreferida)
      ? empresaPreferida!
      : empresas.some((empresa) => empresa.id === usuario.empresa_u)
        ? usuario.empresa_u!
        : empresas[0].id;
    return {
      id: usuario.id_u,
      nome: usuario.nome_u,
      email: usuario.email_u,
      empresaId,
      empresas,
      mustChangePassword: senhaVencida(usuario.data_senha, usuario.atualiza_senha),
    };
  }

  private async empresasDoUsuario(usuario: UsuarioRow): Promise<EmpresaResumo[]> {
    const vinculos = await this.db.query<{ id_empresa: string }>(
      `select id_empresa from dna_work.vinculo_empresa_usuario where id_usuario = $1`,
      [usuario.id_u],
    );
    const ids = [...new Set([usuario.empresa_u, ...vinculos.rows.map((row) => row.id_empresa)].filter((id): id is string => Boolean(id)))];
    if (!ids.length) return [];
    const empresas = await this.db.query<{ id_empresa: string; nome_fantasia: string | null; razao_social: string | null }>(
      `select id_empresa, nome_fantasia, razao_social
       from dna_work.empresa
       where id_empresa = any($1::varchar[])
       order by nome_fantasia, razao_social`,
      [ids],
    );
    return empresas.rows.map((empresa) => ({
      id: empresa.id_empresa,
      nome: (empresa.nome_fantasia || empresa.razao_social || empresa.id_empresa).trim(),
    }));
  }

  private async buscarPorEmail(email: string): Promise<UsuarioRow[]> {
    const sql = `${userSelect} where lower(email_u) = lower($1) and status = 1`;
    try {
      const result = await this.db.query<UsuarioRow>(sql, [email]);
      return result.rows;
    } catch (error) {
      if (codigoPg(error) !== "42703") throw error;
      const result = await this.db.query<Omit<UsuarioRow, "senha_hash">>(
        `select id_u, nome_u, email_u, senha_u, empresa_u, data_senha, atualiza_senha
         from dna_work.usuario_empresa
         where lower(email_u) = lower($1) and status = 1`,
        [email],
      );
      return result.rows.map((row) => ({ ...row, senha_hash: null }));
    }
  }

  private async buscarPorId(id: string): Promise<UsuarioRow> {
    try {
      const result = await this.db.query<UsuarioRow>(`${userSelect} where id_u = $1 and status = 1`, [id]);
      const usuario = result.rows[0];
      if (!usuario) throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
      return usuario;
    } catch (error) {
      if (codigoPg(error) !== "42703") throw error;
      const result = await this.db.query<Omit<UsuarioRow, "senha_hash">>(
        `select id_u, nome_u, email_u, senha_u, empresa_u, data_senha, atualiza_senha
         from dna_work.usuario_empresa where id_u = $1 and status = 1`,
        [id],
      );
      const usuario = result.rows[0];
      if (!usuario) throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
      return { ...usuario, senha_hash: null };
    }
  }

  private async senhaConfere(usuario: UsuarioRow, password: string): Promise<boolean> {
    if (await this.argonConfere(usuario.senha_hash, password)) return true;
    const legado = usuario.senha_u ?? "";
    if (!/^[a-f0-9]{32}$/i.test(legado)) return false;
    const md5 = createHash("md5").update(password).digest("hex");
    return md5.toLowerCase() === legado.toLowerCase();
  }

  private async argonConfere(senhaHash: string | null, password: string): Promise<boolean> {
    if (!senhaHash) return false;
    try {
      return await verify(senhaHash, password);
    } catch {
      return false;
    }
  }

  private async guardarHash(usuarioId: string, password: string): Promise<void> {
    try {
      await this.db.query(
        `update dna_work.usuario_empresa set senha_hash = $2 where id_u = $1`,
        [usuarioId, await hash(password)],
      );
    } catch (error) {
      if (codigoPg(error) !== "42703") throw error;
    }
  }
}

function idsDe(valor: string | null | undefined): Set<string> {
  return new Set((valor ?? "").split("%").map((item) => item.trim()).filter(Boolean));
}

function linkUtil(link: string | null): string | null {
  const texto = link?.trim() ?? "";
  if (!texto || texto === "#") return null;
  return texto;
}

function senhaVencida(dataSenha: string | null, atualiza: number | null): boolean {
  if (atualiza === 1) return true;
  const data = dataSenha?.trim() ?? "";
  if (!data) return true;
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(data);
  if (!match) return false;
  const quando = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const limite = new Date();
  limite.setMonth(limite.getMonth() - 3);
  return quando < limite;
}

function codigoPg(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}
