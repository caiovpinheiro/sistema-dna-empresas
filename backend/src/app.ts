import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import type { EmpresaConfig } from "./config.js";
import { AppError } from "./lib/errors.js";
import { pingServico, tokenDoServico } from "./lib/servico.js";
import { PortalEmpresaService, type SessaoEmpresa } from "./services/portal-empresa.service.js";
import { PortalDadosService } from "./services/portal-dados.service.js";
import { PontoColaboradorService } from "./services/ponto-colaborador.service.js";
import { CadastroPublicoService } from "./services/cadastro-publico.service.js";
import { EMPRESA, PermissoesPontoService as Perm, type Acesso, type Permissao } from "./services/permissoes-ponto.service.js";

const COOKIE = "dnawork_empresa";
const COOKIE_PONTO = "dnawork_ponto";

type EmpresaToken = {
  sub: string;
  email: string;
  role: "empresa";
  nome?: string;
  empresaId?: string;
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: EmpresaToken;
    user: EmpresaToken;
  }
}

type PontoToken = {
  sub: string;
  role: "ponto";
  nome: string;
  empresaId: string;
};

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    pontoColaborador: PontoToken | null;
  }
}

export async function buildEmpresaApp(config: EmpresaConfig, db: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.pin", "req.headers.x-service-token"],
    },
  });
  const portal = new PortalEmpresaService(db);
  const dados = new PortalDadosService(db, { url: config.INTERNO_API_URL, token: config.SERVICE_TOKEN }, (mensagem, extra) => app.log.warn(extra ?? {}, mensagem));
  const ponto = new PontoColaboradorService(db);
  const permissoes = new Perm(db);
  const cadastro = new CadastroPublicoService(db, {
    googleMapsKey: config.GOOGLE_MAPS_API_KEY,
    avisar: (mensagem, extra) => app.log.warn(extra ?? {}, mensagem),
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message, ...(error.campos ? { campos: error.campos } : {}) },
      });
    }
    const err = error as { message?: string; statusCode?: number };
    if (err.statusCode === 429) {
      return reply.code(429).send({
        success: false,
        error: { code: "MUITAS_REQUISICOES", message: "Muitas tentativas. Aguarde um instante." },
      });
    }
    request.log.error({ message: err.message }, "erro interno");
    return reply.code(500).send({ success: false, error: { code: "ERRO_INTERNO", message: "Erro interno." } });
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: "8h" },
    cookie: { cookieName: COOKIE, signed: false },
  });

  app.decorateRequest("pontoColaborador", null);

  app.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
    }
    if (request.user.role !== "empresa" || !request.user.empresaId) {
      throw new AppError(403, "ACESSO_NEGADO", "Acesso negado.");
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0];
    if (request.method === "OPTIONS" || url === "/health" || url === "/api/v1/empresa/login" || url === "/api/v1/ponto/login" || url === "/api/v1/servico/ping" || url === "/api/v1/servico/interno" || url.startsWith("/api/v1/publico/cadastro")) return;
    if (url.startsWith("/api/v1/ponto")) {
      await autenticarPonto(app, request);
      // Desligado (ou tirado do ponto) perde o acesso na hora, mesmo com o login ainda aberto no celular.
      if (!(await ponto.acessoAtivo(request.pontoColaborador!.sub))) {
        reply.clearCookie(COOKIE_PONTO, { path: "/" });
        throw new AppError(401, "ACESSO_ENCERRADO", "Seu acesso ao ponto foi encerrado. Fale com a empresa.");
      }
      return;
    }
    if (url.startsWith("/api/")) {
      await app.authenticate(request);
      if (request.user.empresaId) {
        await portal.registrarAcesso([request.user.empresaId], request.user.sub, request.user.email, false);
      }
    }
  });

  const idDe = (request: FastifyRequest) => String((request.params as { id?: string }).id ?? "");

  app.get("/health", async () => ({ ok: true, servico: "empresas" }));

  const limiteCadastro = { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } };
  app.get("/api/v1/publico/cadastro/termos", async () => ({ success: true, data: cadastro.termos() }));
  app.get("/api/v1/publico/cadastro/cep/:cep", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const cep = (request.params as { cep: string }).cep;
    const endereco = await cadastro.consultarCep(cep);
    if (!endereco) throw new AppError(404, "CEP_NAO_ENCONTRADO", "Não encontramos este CEP. Preencha o endereço abaixo.");
    return { success: true, data: endereco };
  });
  app.get("/api/v1/publico/cadastro/cnpj/:cnpj", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request) => {
    const cnpj = (request.params as { cnpj: string }).cnpj;
    return { success: true, data: await cadastro.consultarCnpj(cnpj) };
  });
  app.post("/api/v1/publico/cadastro", limiteCadastro, async (request) => {
    const bruto = request.body;
    const website = bruto && typeof bruto === "object" && "website" in bruto ? String((bruto as { website?: unknown }).website ?? "") : "";
    if (website.trim()) throw new AppError(422, "CADASTRO_RECUSADO", "Não foi possível concluir o cadastro.");
    return { success: true, data: await cadastro.concluir(bruto, request.ip) };
  });

  app.get("/api/v1/servico/ping", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    return { success: true, data: { servico: "empresas" } };
  });

  app.get("/api/v1/servico/interno", async (request) => {
    if (!tokenDoServico(request.headers["x-service-token"], config.SERVICE_TOKEN)) {
      throw new AppError(401, "SERVICO_NEGADO", "Serviço não autorizado.");
    }
    if (!config.INTERNO_API_URL) throw new AppError(503, "SERVICO_NAO_CONFIGURADO", "INTERNO_API_URL não está definido.");
    const interno = await pingServico(config.INTERNO_API_URL, config.SERVICE_TOKEN);
    return { success: true, data: interno };
  });

  app.post("/api/v1/empresa/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = ler(z.object({ email: z.string().trim().min(3), password: z.string().min(1).max(200) }), request.body);
    const sessao = await portal.login(body.email.trim(), body.password);
    const token = await reply.jwtSign(payloadDe(sessao));
    reply.setCookie(COOKIE, token, cookieOptions(config));
    return { success: true, data: sessao };
  });

  app.post("/api/v1/empresa/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { success: true, data: { ok: true } };
  });

  app.get("/api/v1/empresa/sessao", async (request) => {
    const sessao = await portal.sessao(request.user.sub, request.user.empresaId!);
    return { success: true, data: { ...sessao, acesso: Perm.resumo(EMPRESA) } };
  });

  app.post("/api/v1/empresa/sessao/empresa", async (request, reply) => {
    const body = ler(z.object({ empresaId: z.string().trim().min(1) }), request.body);
    const sessao = await portal.trocarEmpresa(request.user.sub, body.empresaId);
    const token = await reply.jwtSign(payloadDe(sessao));
    reply.setCookie(COOKIE, token, cookieOptions(config));
    return { success: true, data: sessao };
  });

  app.post("/api/v1/empresa/senha", async (request) => {
    const body = ler(z.object({ password: z.string().min(6).max(200), senhaAtual: z.string().max(200).optional() }), request.body);
    await portal.trocarSenha(request.user.sub, body.password, body.senhaAtual);
    const sessao = await portal.sessao(request.user.sub, request.user.empresaId!);
    return { success: true, data: sessao };
  });

  app.get("/api/v1/empresa/menu", async (request) => {
    const menu = await portal.menu(request.user.sub, request.user.empresaId!);
    return { success: true, data: menu };
  });

  app.get("/api/v1/empresa/painel", async (request) => ({
    success: true,
    data: await dados.painel(request.user.sub, request.user.empresaId!),
  }));
  app.get("/api/v1/empresa/colaboradores", async (request) => {
    const query = ler(z.object({
      q: z.string().optional(),
      status: z.enum(["ativo", "inativo", "todos"]).optional(),
    }), request.query);
    return { success: true, data: await dados.colaboradores(request.user.sub, request.user.empresaId!, query.q?.trim() ?? "", query.status ?? "todos") };
  });
  app.get("/api/v1/empresa/vagas", async (request) => {
    const busca = ler(z.object({ q: z.string().optional() }), request.query).q?.trim() ?? "";
    return { success: true, data: await dados.vagas(request.user.sub, request.user.empresaId!, busca) };
  });
  app.get("/api/v1/empresa/contratados", async (request) => {
    const busca = ler(z.object({ q: z.string().optional() }), request.query).q?.trim() ?? "";
    return { success: true, data: await dados.contratados(request.user.sub, request.user.empresaId!, busca) };
  });
  app.get("/api/v1/empresa/detalhe/:tipo/:id", async (request) => {
    const { tipo, id } = request.params as { tipo: string; id: string };
    return { success: true, data: await dados.detalhe(request.user.sub, request.user.empresaId!, tipo, id) };
  });
  app.post("/api/v1/empresa/vagas", async (request) => ({ success: true, data: await dados.salvarVaga(request.user.sub, request.user.empresaId!, corpo(request.body), request.user.email) }));
  app.post("/api/v1/empresa/vagas/:id/cancelar", async (request) => {
    const { id } = request.params as { id: string };
    return { success: true, data: await dados.cancelarVaga(request.user.sub, request.user.empresaId!, id, request.user.email ?? "") };
  });
  app.get("/api/v1/empresa/empresa", async (request) => ({ success: true, data: await dados.empresa(request.user.sub, request.user.empresaId!) }));
  app.post("/api/v1/empresa/filiais", async (request) => ({ success: true, data: await dados.salvarFilial(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.get("/api/v1/empresa/usuarios", async (request) => ({ success: true, data: await dados.usuarios(request.user.sub, request.user.empresaId!) }));
  // O acesso da empresa ao portal é um só: não se cria outro usuário. Quem ajuda no ponto recebe permissões no app do ponto.
  app.post("/api/v1/empresa/usuarios", async () => {
    throw new AppError(403, "ACESSO_UNICO", "O acesso da empresa ao portal é único. Para alguém ajudar no ponto, dê permissões ao colaborador em Ponto › Permissões.");
  });
  // Permissões que a empresa dá aos colaboradores para cuidarem do ponto de outros pelo app do ponto.
  app.get("/api/v1/empresa/ponto/permissoes", async (request) => ({ success: true, data: await permissoes.lista(request.user.empresaId!) }));
  app.get("/api/v1/empresa/ponto/permissoes/:id", async (request) => ({ success: true, data: await permissoes.configuracao(request.user.empresaId!, idDe(request)) }));
  app.put("/api/v1/empresa/ponto/permissoes/:id", async (request) => ({ success: true, data: await permissoes.salvar(request.user.empresaId!, idDe(request), request.body) }));

  app.get("/api/v1/empresa/talentos", async (request) => ({ success: true, data: await dados.talentos(request.user.sub, request.user.empresaId!) }));
  app.post("/api/v1/empresa/talentos", async (request) => ({ success: true, data: await dados.salvarTalento(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.get("/api/v1/empresa/encaminhamentos", async (request) => ({ success: true, data: await dados.encaminhamentos(request.user.sub, request.user.empresaId!) }));
  app.get("/api/v1/empresa/documentos", async (request) => ({ success: true, data: await dados.documentos(request.user.sub, request.user.empresaId!) }));
  app.get("/api/v1/empresa/seguro", async (request) => ({ success: true, data: await dados.seguro(request.user.sub, request.user.empresaId!) }));
  app.get("/api/v1/empresa/calendario", async (request) => ({ success: true, data: await dados.calendario(request.user.sub, request.user.empresaId!) }));
  app.get("/api/v1/empresa/avaliacoes", async (request) => ({ success: true, data: await dados.avaliacoes(request.user.sub, request.user.empresaId!) }));
  app.get("/api/v1/empresa/holerites", async (request) => ({ success: true, data: await dados.holerites(request.user.sub, request.user.empresaId!) }));
  app.get("/api/v1/empresa/faturas", async (request) => {
    const situacao = ler(z.object({ situacao: z.enum(["aberta", "paga", "todas"]).optional() }), request.query).situacao ?? "aberta";
    return { success: true, data: await dados.faturas(request.user.sub, request.user.empresaId!, situacao) };
  });

  /**
   * Rotas do ponto que valem para dois públicos:
   * - /api/v1/empresa/...: a empresa (login do portal), que vê e faz tudo;
   * - /api/v1/ponto/gestao/...: o colaborador com permissões, pelo app do ponto, só no que a empresa liberou e só para os
   *   colaboradores escolhidos. Quem não está liberado para ele não aparece (404, como se não existisse).
   * As funções do portal conferem a empresa pelo login dela; quando quem age é o colaborador, ele fica gravado em id_gestor.
   */
  type Contexto = { usuarioId: string; empresaId: string; acesso: Acesso };
  const daEmpresa = async (request: FastifyRequest): Promise<Contexto> => ({ usuarioId: request.user.sub, empresaId: request.user.empresaId!, acesso: EMPRESA });
  const doGestor = async (request: FastifyRequest): Promise<Contexto> => {
    const gestor = await permissoes.gestor(request.pontoColaborador!.sub);
    if (!gestor || !gestor.acesso.permissoes.size || !gestor.usuarioEmpresa) {
      throw new AppError(403, "SEM_PERMISSAO", "Você não tem permissão para cuidar do ponto de outros colaboradores.");
    }
    return { usuarioId: gestor.usuarioEmpresa, empresaId: gestor.empresaId, acesso: gestor.acesso };
  };
  type Guarda = (request: FastifyRequest, c: Contexto) => Promise<void> | void;
  const rotaDoPonto = (metodo: "GET" | "POST" | "PUT" | "DELETE", caminho: string, guarda: Guarda, executar: (request: FastifyRequest, c: Contexto) => Promise<unknown>) => {
    for (const [base, contexto] of [["/api/v1/empresa", daEmpresa], ["/api/v1/ponto/gestao", doGestor]] as const) {
      app.route({
        method: metodo,
        url: base + caminho,
        handler: async (request) => {
          const c = await contexto(request);
          if (c.acesso.limitado) await guarda(request, c);
          return { success: true, data: await executar(request, c) };
        },
      });
    }
  };
  const qualquer = (c: Contexto, lista: Permissao[]) => {
    if (!lista.some((permissao) => Perm.tem(c.acesso, permissao))) Perm.exigir(c.acesso, lista[0]);
  };
  const noAlcance = (request: FastifyRequest, c: Contexto, lista: Permissao[]) => {
    const alcance = Perm.alcanceDeQualquer(c.acesso, lista);
    if (alcance && !alcance.has(idDe(request))) throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado.");
  };
  const cadastroDe: Guarda = (request, c) => {
    Perm.exigir(c.acesso, "cadastro", idDe(request));
    Perm.naoEhOProprio(c.acesso, idDe(request));
  };
  const gestorDe = (c: Contexto) => (c.acesso.limitado ? c.acesso.eu : null);

  app.get("/api/v1/ponto/gestao/sessao", async (request) => {
    const gestor = await permissoes.gestor(request.pontoColaborador!.sub);
    const acesso = gestor?.acesso ?? { limitado: true, eu: "", permissoes: new Map() };
    return { success: true, data: { acesso: Perm.resumo(acesso), abas: Perm.abas(acesso) } };
  });

  // Jornada de trabalho = dias de trabalho + horário de cada dia (escala e carga horária num cadastro só).
  const verAlgo: Guarda = (_r, c) => qualquer(c, ["ver", "cadastro", "empresa"]);
  const soEmpresa: Guarda = (_r, c) => Perm.exigir(c.acesso, "empresa");
  rotaDoPonto("GET", "/jornadas", verAlgo, (_r, c) => dados.jornadas(c.usuarioId, c.empresaId));
  rotaDoPonto("GET", "/jornadas/:id", verAlgo, (r, c) => dados.jornada(c.usuarioId, c.empresaId, idDe(r)));
  rotaDoPonto("POST", "/jornadas", soEmpresa, (r, c) => dados.salvarJornadaEmpresa(c.usuarioId, c.empresaId, corpo(r.body)));
  rotaDoPonto("PUT", "/jornadas/:id", soEmpresa, (r, c) => dados.salvarJornadaEmpresa(c.usuarioId, c.empresaId, corpo(r.body), idDe(r)));
  rotaDoPonto("DELETE", "/jornadas/:id", soEmpresa, (r, c) => dados.excluirJornada(c.usuarioId, c.empresaId, idDe(r)));
  rotaDoPonto("GET", "/feriados", verAlgo, (r, c) => dados.feriados(c.usuarioId, c.empresaId, (r.query as { ano?: string }).ano));
  rotaDoPonto("POST", "/feriados", soEmpresa, (r, c) => dados.salvarFeriado(c.usuarioId, c.empresaId, corpo(r.body)));
  rotaDoPonto("DELETE", "/feriados/:id", soEmpresa, (r, c) => dados.excluirFeriado(c.usuarioId, c.empresaId, idDe(r)));

  rotaDoPonto("GET", "/ponto/solicitacoes", (_r, c) => Perm.exigir(c.acesso, "solicitacoes"), async (r, c) => {
    const { situacao } = ler(z.object({ situacao: z.enum(["pendentes", "todas"]).optional() }), r.query);
    const lista = await dados.solicitacoesPonto(c.usuarioId, c.empresaId, situacao ?? "pendentes", Perm.alcance(c.acesso, "solicitacoes"));
    // Os pedidos do próprio colaborador não aparecem para ele aprovar: vão para a empresa.
    return c.acesso.limitado ? lista.filter((pedido) => String(pedido.id_candidato) !== c.acesso.eu) : lista;
  });
  const resposta = z.object({ aprovar: z.boolean(), resposta: z.string().max(255).optional() });
  const idNumero = z.object({ id: z.coerce.number().int().positive() });
  rotaDoPonto("POST", "/ponto/solicitacoes/:id", async (r, c) => {
    const candidato = await permissoes.candidatoDoAjuste(Number(idDe(r)), c.empresaId);
    Perm.exigir(c.acesso, "solicitacoes", candidato);
    Perm.naoEhOProprio(c.acesso, candidato);
  }, (r, c) => {
    const { id } = ler(idNumero, r.params);
    const body = ler(resposta, r.body);
    return dados.responderSolicitacao(c.usuarioId, c.empresaId, id, body.aprovar, body.resposta ?? "", gestorDe(c));
  });
  rotaDoPonto("POST", "/ponto/inclusoes/:id", async (r, c) => {
    const candidato = await permissoes.candidatoDaInclusao(Number(idDe(r)), c.empresaId);
    Perm.exigir(c.acesso, "solicitacoes", candidato);
    Perm.naoEhOProprio(c.acesso, candidato);
  }, (r, c) => {
    const { id } = ler(idNumero, r.params);
    const body = ler(resposta, r.body);
    return dados.responderInclusao(c.usuarioId, c.empresaId, id, body.aprovar, body.resposta ?? "", gestorDe(c));
  });
  rotaDoPonto("GET", "/ponto/relatorio", (_r, c) => Perm.exigir(c.acesso, "ver"), (r, c) => {
    const periodo = ler(z.object({ de: z.string().optional(), ate: z.string().optional() }), r.query);
    return dados.relatorioPonto(c.usuarioId, c.empresaId, periodo.de, periodo.ate, Perm.alcance(c.acesso, "ver"));
  });
  // Configuração do ponto de uma pessoa (:id = id_candidato, o mesmo da tela do relatório).
  rotaDoPonto("GET", "/ponto/colaborador/:id/configuracao", (r, c) => { qualquer(c, ["ver", "cadastro", "empresa"]); noAlcance(r, c, ["ver", "cadastro", "empresa"]); },
    (r, c) => dados.configuracaoPonto(c.usuarioId, c.empresaId, idDe(r)));
  rotaDoPonto("POST", "/ponto/colaborador/:id/jornada", cadastroDe, (r, c) => dados.salvarJornada(c.usuarioId, c.empresaId, idDe(r), corpo(r.body)));
  rotaDoPonto("POST", "/ponto/colaborador/:id/senha", cadastroDe, (r, c) => {
    const body = ler(z.object({ senha: z.string().max(200) }), r.body);
    return dados.redefinirSenhaColaborador(c.usuarioId, c.empresaId, idDe(r), body.senha);
  });
  // "Apagar" na tela = desligar: os registros de ponto ficam guardados (obrigação legal da empresa).
  rotaDoPonto("POST", "/ponto/colaborador/:id/desligar", cadastroDe, (r, c) => {
    const body = ler(z.object({ ultimoDia: z.string().optional() }), r.body ?? {});
    return dados.desligarColaborador(c.usuarioId, c.empresaId, idDe(r), body.ultimoDia);
  });
  const feriasDe: Guarda = (r, c) => Perm.exigir(c.acesso, "empresa", idDe(r));
  rotaDoPonto("POST", "/ponto/colaborador/:id/ferias", feriasDe, (r, c) => dados.salvarFerias(c.usuarioId, c.empresaId, idDe(r), corpo(r.body)));
  rotaDoPonto("DELETE", "/ponto/colaborador/:id/ferias/:ferias", feriasDe, (r, c) => dados.excluirFerias(c.usuarioId, c.empresaId, idDe(r), String((r.params as { ferias: string }).ferias)));
  rotaDoPonto("GET", "/ponto/colaboradores", (_r, c) => qualquer(c, ["ver", "cadastro", "empresa"]), (r, c) => {
    const query = ler(z.object({ q: z.string().optional(), status: z.enum(["ativo", "inativo", "todos"]).optional() }), r.query);
    return dados.colaboradoresPonto(c.usuarioId, c.empresaId, query.q?.trim() ?? "", query.status ?? "todos", Perm.alcanceDeQualquer(c.acesso, ["ver", "cadastro", "empresa"]));
  });
  rotaDoPonto("GET", "/ponto/colaborador/:id", (r, c) => { qualquer(c, ["ver", "cadastro", "empresa"]); noAlcance(r, c, ["ver", "cadastro", "empresa"]); }, async (r, c) => {
    const periodo = ler(z.object({ de: z.string().optional(), ate: z.string().optional() }), r.query);
    const id = idDe(r);
    const relatorio = await dados.relatorioPontoColaborador(c.usuarioId, c.empresaId, id, periodo.de, periodo.ate);
    // Só com "cadastro" (sem "ver"): abre a ficha para cadastrar e configurar, mas sem as batidas e o saldo.
    const alcanceVer = Perm.alcance(c.acesso, "ver");
    const podeVer = Perm.tem(c.acesso, "ver") && (!alcanceVer || alcanceVer.has(id));
    if (!podeVer) return { ...relatorio, dias: [], periodo: null, periodoAnterior: null, total: null, semPermissaoVer: true };
    return relatorio;
  });
  rotaDoPonto("POST", "/colaboradores", (_r, c) => Perm.exigir(c.acesso, "cadastro"), async (r, c) => {
    const salvo = await dados.salvarColaborador(c.usuarioId, c.empresaId, corpo(r.body));
    // Colaborador com permissão passa a enxergar quem ele acabou de cadastrar.
    const idCandidato = c.acesso.limitado ? await permissoes.candidatoDoColaborador(String(salvo.id)) : null;
    if (idCandidato) await permissoes.incluirNoAlcance(c.empresaId, c.acesso, idCandidato);
    return salvo;
  });

  app.post("/api/v1/ponto/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = ler(z.object({ cpf: z.string().trim().min(11), password: z.string().min(1).max(200) }), request.body);
    const pessoa = await ponto.login(body.cpf, body.password);
    const token = app.jwt.sign({ sub: pessoa.id_colaborador, role: "ponto", nome: pessoa.nome, empresaId: pessoa.id_empresa } as unknown as EmpresaToken);
    reply.setCookie(COOKIE_PONTO, token, cookieOptions(config));
    return { success: true, data: { nome: pessoa.nome, empresa: pessoa.empresa } };
  });
  app.post("/api/v1/ponto/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_PONTO, { path: "/" });
    return { success: true, data: { ok: true } };
  });
  app.get("/api/v1/ponto/painel", async (request) => ({
    success: true,
    data: await ponto.painel(request.pontoColaborador!.sub),
  }));
  app.post("/api/v1/ponto/bater", async (request) => {
    const body = ler(z.object({
      confirmar: z.boolean().optional(),
      latitude: z.number().finite().optional(),
      longitude: z.number().finite().optional(),
    }), request.body);
    const dispositivo = String(request.headers["user-agent"] ?? "").slice(0, 100);
    return {
      success: true,
      data: await ponto.bater(request.pontoColaborador!.sub, body.confirmar === true, body.latitude ?? null, body.longitude ?? null, dispositivo),
    };
  });
  app.post("/api/v1/ponto/senha", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const body = ler(z.object({ senhaAtual: z.string().min(1).max(200), senhaNova: z.string().min(1).max(200) }), request.body);
    return { success: true, data: await ponto.trocarSenha(request.pontoColaborador!.sub, body.senhaAtual, body.senhaNova) };
  });
  app.get("/api/v1/ponto/solicitacoes", async (request) => ({
    success: true,
    data: await ponto.solicitacoes(request.pontoColaborador!.sub),
  }));
  app.post("/api/v1/ponto/solicitacoes", async (request) => {
    const body = ler(z.object({
      idPonto: z.number().int().positive(),
      tipo: z.enum(["entrada", "saida"]),
      hora: z.string().trim().max(5),
      motivo: z.string().max(255),
    }), request.body);
    return { success: true, data: await ponto.solicitar(request.pontoColaborador!.sub, body) };
  });
  app.post("/api/v1/ponto/inclusoes", async (request) => {
    const body = ler(z.object({
      data: z.string().trim().max(10),
      entrada: z.string().trim().max(5),
      saida: z.string().trim().max(5),
      motivo: z.string().max(255),
    }), request.body);
    return { success: true, data: await ponto.incluir(request.pontoColaborador!.sub, body) };
  });

  await servirFrontend(app);
  return app;
}

function payloadDe(sessao: SessaoEmpresa): EmpresaToken {
  return { sub: sessao.id, email: sessao.email, role: "empresa", nome: sessao.nome, empresaId: sessao.empresaId };
}

async function autenticarPonto(app: FastifyInstance, request: FastifyRequest) {
  const token = request.cookies[COOKIE_PONTO];
  if (!token) throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
  try {
    const dados = app.jwt.verify<PontoToken>(token);
    if (dados.role !== "ponto" || !dados.sub) throw new Error("papel");
    request.pontoColaborador = dados;
  } catch {
    throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
  }
}

function ler<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(422, "VALIDACAO", "Dados inválidos.");
  return parsed.data;
}

function corpo(body: unknown): Record<string, string> {
  const parsed = z.record(z.string(), z.union([z.string(), z.number()])).safeParse(body);
  if (!parsed.success) throw new AppError(422, "VALIDACAO", "Dados inválidos.");
  return Object.fromEntries(Object.entries(parsed.data).map(([chave, valor]) => [chave, String(valor)]));
}

function cookieOptions(config: EmpresaConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: config.COOKIE_SECURE,
    maxAge: 60 * 60 * 8,
  };
}

async function servirFrontend(app: FastifyInstance): Promise<void> {
  const dist = process.env.FRONTEND_DIST;
  if (!dist || !fs.existsSync(dist)) return;
  await app.register(fastifyStatic, { root: path.resolve(dist) });
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split("?")[0];
    if (request.method === "GET" && !url.startsWith("/api")) return reply.sendFile("index.html");
    return reply.code(404).send({ success: false, error: { code: "NAO_ENCONTRADO", message: "Rota não encontrada." } });
  });
}
