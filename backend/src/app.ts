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

const COOKIE = "dnawork_empresa";

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

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

export async function buildEmpresaApp(config: EmpresaConfig, db: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.headers.x-service-token"],
    },
  });
  const portal = new PortalEmpresaService(db);
  const dados = new PortalDadosService(db);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message },
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

  app.addHook("onRequest", async (request) => {
    const url = request.url.split("?")[0];
    if (request.method === "OPTIONS" || url === "/health" || url === "/api/v1/empresa/login" || url === "/api/v1/servico/ping" || url === "/api/v1/servico/interno") return;
    if (url.startsWith("/api/")) await app.authenticate(request);
  });

  app.get("/health", async () => ({ ok: true, servico: "empresas" }));

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
    return { success: true, data: sessao };
  });

  app.post("/api/v1/empresa/sessao/empresa", async (request, reply) => {
    const body = ler(z.object({ empresaId: z.string().trim().min(1) }), request.body);
    const sessao = await portal.trocarEmpresa(request.user.sub, body.empresaId);
    const token = await reply.jwtSign(payloadDe(sessao));
    reply.setCookie(COOKIE, token, cookieOptions(config));
    return { success: true, data: sessao };
  });

  app.post("/api/v1/empresa/senha", async (request) => {
    const body = ler(z.object({ password: z.string().min(6).max(200) }), request.body);
    await portal.trocarSenha(request.user.sub, body.password);
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
    const busca = ler(z.object({ q: z.string().optional() }), request.query).q?.trim() ?? "";
    return { success: true, data: await dados.colaboradores(request.user.sub, request.user.empresaId!, busca) };
  });
  app.get("/api/v1/empresa/vagas", async (request) => {
    const busca = ler(z.object({ q: z.string().optional() }), request.query).q?.trim() ?? "";
    return { success: true, data: await dados.vagas(request.user.sub, request.user.empresaId!, busca) };
  });
  app.get("/api/v1/empresa/contratados", async (request) => {
    const busca = ler(z.object({ q: z.string().optional() }), request.query).q?.trim() ?? "";
    return { success: true, data: await dados.contratados(request.user.sub, request.user.empresaId!, busca) };
  });
  app.get("/api/v1/empresa/escalas", async (request) => ({ success: true, data: await dados.escalas(request.user.sub, request.user.empresaId!) }));
  app.post("/api/v1/empresa/escalas", async (request) => ({ success: true, data: await dados.salvarEscala(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.get("/api/v1/empresa/cargas", async (request) => ({ success: true, data: await dados.cargas(request.user.sub, request.user.empresaId!) }));
  app.post("/api/v1/empresa/cargas", async (request) => ({ success: true, data: await dados.salvarCarga(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.get("/api/v1/empresa/feriados", async (request) => ({ success: true, data: await dados.feriados(request.user.sub, request.user.empresaId!) }));
  app.post("/api/v1/empresa/feriados", async (request) => ({ success: true, data: await dados.salvarFeriado(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.post("/api/v1/empresa/colaboradores", async (request) => ({ success: true, data: await dados.salvarColaborador(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.post("/api/v1/empresa/vagas", async (request) => ({ success: true, data: await dados.salvarVaga(request.user.sub, request.user.empresaId!, corpo(request.body)) }));
  app.get("/api/v1/empresa/faturas", async (request) => {
    const situacao = ler(z.object({ situacao: z.enum(["aberta", "paga", "todas"]).optional() }), request.query).situacao ?? "aberta";
    return { success: true, data: await dados.faturas(request.user.sub, request.user.empresaId!, situacao) };
  });

  await servirFrontend(app);
  return app;
}

function payloadDe(sessao: SessaoEmpresa): EmpresaToken {
  return { sub: sessao.id, email: sessao.email, role: "empresa", nome: sessao.nome, empresaId: sessao.empresaId };
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
