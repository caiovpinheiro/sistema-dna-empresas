import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, Check, ChevronDown, Circle, Clock, Gauge, GraduationCap, LayoutDashboard, Lock, LogOut, Menu, Settings, User, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Field, Input } from "./components/ui";
import { ApiError, api } from "./lib/api";

type Empresa = { id: string; nome: string };
type Sessao = {
  nome: string;
  email: string;
  empresaId: string;
  empresas: Empresa[];
  mustChangePassword: boolean;
};
type ItemMenu = { id: string; label: string; link: string | null; children: ItemMenu[] };

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<Protegido />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function Protegido() {
  const sessao = useQuery({ queryKey: ["sessao-empresa"], queryFn: () => api<Sessao>("/api/v1/empresa/sessao") });
  if (sessao.isLoading) return <TelaCentral>Carregando sessão…</TelaCentral>;
  if (sessao.isError || !sessao.data) return <Navigate to="/login" replace />;
  const dados = sessao.data.data;
  if (dados.mustChangePassword) return <SenhaPage />;
  return (
    <Routes>
      <Route path="/" element={<Portal sessao={dados} />} />
      <Route path="/opcao" element={<Portal sessao={dados} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Portal({ sessao }: { sessao: Sessao }) {
  const menu = useQuery({ queryKey: ["menu-empresa", sessao.empresaId], queryFn: () => api<ItemMenu[]>("/api/v1/empresa/menu") });
  const [params] = useSearchParams();
  const [aberto, setAberto] = useState(false);
  const [hover, setHover] = useState(false);
  const link = params.get("link");
  const itens = menu.data?.data ?? [];
  const atual = link ? achar(itens, link) : null;
  const empresa = sessao.empresas.find((item) => item.id === sessao.empresaId)?.nome;
  const expandido = aberto || hover;

  return (
    <div className="flex min-h-screen">
      {aberto ? <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-[#24182d]/40 md:hidden" onClick={() => setAberto(false)} /> : null}
      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`${aberto ? "fixed inset-y-0 z-50 flex w-72" : "hidden"} flex-col overflow-x-hidden bg-neutral-100 text-neutral-800 shadow-[4px_0_24px_rgb(49_10_80_/_8%)] transition-[width] duration-300 ease-out md:static md:flex md:min-h-screen ${hover ? "md:w-72" : "md:w-[72px]"}`}
      >
        <div className={`flex items-center py-4 ${expandido ? "gap-3 px-4" : "justify-center px-2"}`}>
          <img src="/logo-mono.png" alt="DNA Work" className={`shrink-0 object-contain ${expandido ? "h-9 w-16" : "h-8 w-12"}`} />
          <div className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${expandido ? "w-auto opacity-100" : "w-0 opacity-0"}`}>
            <p className="text-xs font-bold tracking-wide uppercase text-[#5b21b6]">DNAWORK</p>
            <h1 className="text-base font-extrabold leading-5">Empresas</h1>
          </div>
          <button className={`rounded-xl p-2 hover:bg-black/5 md:hidden ${expandido ? "ml-auto" : "hidden"}`} aria-label="Fechar" onClick={() => setAberto(false)}><X size={18} /></button>
        </div>
        <div className={`overflow-hidden px-4 transition-all duration-300 ${expandido ? "max-h-28 opacity-100" : "max-h-0 opacity-0"}`}>
          <p className="truncate text-sm text-neutral-500">{sessao.nome}</p>
          <EmpresaSelect empresas={sessao.empresas} atual={sessao.empresaId} />
        </div>
        <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3" aria-label="Menu da empresa">
          {menu.isLoading ? <p className="px-2 text-sm text-white/70">Carregando menu…</p> : null}
          {menu.isError ? <p className="px-2 text-sm">{menu.error instanceof ApiError ? menu.error.message : "Não foi possível carregar o menu."}</p> : null}
          {!menu.isLoading && !menu.isError && itens.length === 0 ? <p className="px-2 text-sm text-white/70">Nenhuma opção liberada para este usuário.</p> : null}
          <ul className="grid gap-1">
            {itens.map((item) => <Ramo key={item.id} item={item} ativo={link} expandido={expandido} onNavigate={() => setAberto(false)} />)}
          </ul>
        </nav>
        <div className="p-2">
          <Sair compacto={!expandido} />
        </div>
      </aside>
      <div className="min-w-0 flex-1 bg-[#f6f3f8]">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-slate-100 active:scale-95 md:hidden" aria-label="Abrir menu" onClick={() => setAberto(true)}><Menu size={18} /></button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-600">{empresa}</p>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-6 md:px-8">
          {link && !atual ? (
            <Painel titulo="Opção não liberada" texto="Esta tela não faz parte das opções deste usuário." />
          ) : atual ? (
            <Painel titulo={atual.label} texto="Esta é a mesma opção do portal que a empresa já acessa. A tela desta função entra na sequência, com o mesmo nome." detalhe={atual.link ?? undefined} />
          ) : (
            <Painel titulo="Início" texto="Passe o mouse na barra da esquerda para abrir o menu. As opções continuam sendo as desta empresa e deste usuário." />
          )}
        </main>
      </div>
    </div>
  );
}

function Ramo({ item, ativo, expandido, onNavigate, nivel = 0 }: { item: ItemMenu; ativo: string | null; expandido: boolean; onNavigate: () => void; nivel?: number }) {
  const [open, setOpen] = useState(false);
  const Icon = iconeDe(item.label);
  useEffect(() => {
    if (!expandido) setOpen(false);
  }, [expandido]);
  const texto = <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${expandido ? "max-w-48 opacity-100" : "max-w-0 opacity-0"}`}>{item.label}</span>;
  if (item.link) {
    const href = item.link === "principal.php" ? "/" : `/opcao?link=${encodeURIComponent(item.link)}`;
    const marcado = item.link === "principal.php" ? !ativo : ativo === item.link;
    return (
      <li>
        <Link to={href} onClick={onNavigate} title={item.label} className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition duration-200 ${marcado ? "bg-[#5b21b6] text-white" : "text-neutral-700 hover:bg-white hover:shadow-sm"}`}>
          {nivel === 0 ? <Icon size={18} className="shrink-0" /> : <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
          {texto}
        </Link>
      </li>
    );
  }
  return (
    <li className="grid gap-1">
      <button type="button" aria-expanded={open && expandido} title={item.label} onClick={() => setOpen((value) => !value)} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-neutral-700 transition duration-200 hover:bg-white hover:shadow-sm">
        <Icon size={18} className="shrink-0" />
        {texto}
        <ChevronDown size={16} className={`ml-auto shrink-0 transition duration-200 ${expandido ? "" : "w-0 overflow-hidden opacity-0"} ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && expandido ? (
        <ul className="nav-sub grid gap-1 pl-4">
          {item.children.map((filho) => <Ramo key={filho.id} item={filho} ativo={ativo} expandido={expandido} onNavigate={onNavigate} nivel={nivel + 1} />)}
        </ul>
      ) : null}
    </li>
  );
}

function EmpresaSelect({ empresas, atual }: { empresas: Empresa[]; atual: string }) {
  const queryClient = useQueryClient();
  const trocar = useMutation({
    mutationFn: (empresaId: string) => api("/api/v1/empresa/sessao/empresa", { method: "POST", body: JSON.stringify({ empresaId }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessao-empresa"] });
      await queryClient.invalidateQueries({ queryKey: ["menu-empresa"] });
    },
  });
  if (empresas.length < 2) return null;
  return (
    <select className="mt-2 h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-800" value={atual} onChange={(event) => trocar.mutate(event.target.value)} aria-label="Empresa">
      {empresas.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}
    </select>
  );
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const [entrou, setEntrou] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: () => api<{ nome?: string }>("/api/v1/empresa/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: async (resposta) => {
      await queryClient.invalidateQueries({ queryKey: ["sessao-empresa"] });
      setEntrou(resposta.data.nome || email);
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Falha no login."),
  });
  useEffect(() => {
    if (!entrou) return;
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => navigate("/"), reduzido ? 350 : 1100);
    return () => window.clearTimeout(timer);
  }, [entrou, navigate]);
  if (entrou) {
    return (
      <FundoRoxo className="login-veil" papel="status">
        <div className="login-ok">
          <span className="login-badge">
            <span className="login-ring" />
            <Check size={36} strokeWidth={2.6} />
          </span>
          <p className="login-title">Login realizado</p>
          <p className="login-sub">{entrou}</p>
        </div>
      </FundoRoxo>
    );
  }
  return (
    <TelaCentral>
      <form className="relative mt-12 w-full max-w-md rounded-[2rem] bg-white px-8 pb-8 pt-16 shadow-[0_24px_50px_rgb(49_10_80_/_18%)]" onSubmit={(event) => { event.preventDefault(); setErro(""); login.mutate(); }}>
        <span className="absolute left-1/2 top-0 z-10 flex h-24 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-white px-3 shadow-[0_14px_28px_rgb(49_10_80_/_18%)]">
          <img src="/logo-mono.png" alt="DNA Work" className="h-12 w-full object-contain" />
        </span>
        <label className="relative block">
          <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input className="h-12 w-full rounded-full bg-[#eceff3] pl-11 pr-4 text-sm outline-none focus:ring-4 focus:ring-[#7c3aed]/20" type="text" autoComplete="username" required placeholder="E-mail" aria-label="E-mail" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="relative mt-4 block">
          <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input className="h-12 w-full rounded-full bg-[#eceff3] pl-11 pr-4 text-sm outline-none focus:ring-4 focus:ring-[#7c3aed]/20" type="password" autoComplete="current-password" required placeholder="Senha" aria-label="Senha" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {erro ? <p className="mt-3 text-sm text-rose-600" role="alert">{erro}</p> : null}
        <button className="mt-6 h-12 w-full rounded-full bg-[#7c3aed] text-sm font-bold tracking-wide text-white transition duration-200 hover:bg-[#6d28d9] active:scale-[0.98] disabled:opacity-60" disabled={login.isPending}>
          {login.isPending ? "ENTRANDO…" : "ENTRAR"}
        </button>
      </form>
    </TelaCentral>
  );
}

function SenhaPage() {
  const [password, setPassword] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const queryClient = useQueryClient();
  const salvar = useMutation({
    mutationFn: () => api("/api/v1/empresa/senha", { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessao-empresa"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível atualizar a senha."),
  });
  return (
    <TelaCentral>
      <Card className="w-full max-w-md p-8 hover:translate-y-0">
        <h1 className="text-2xl font-extrabold">Atualize sua senha</h1>
        <p className="mt-2 text-sm text-slate-500">O acesso da empresa pede uma senha nova, como no portal atual.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (password !== confirma) { setErro("As senhas não conferem."); return; }
          setErro("");
          salvar.mutate();
        }}>
          <Field label="Nova senha"><Input type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="Confirmar"><Input type="password" minLength={6} required value={confirma} onChange={(event) => setConfirma(event.target.value)} /></Field>
          {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
          <Button type="submit" disabled={salvar.isPending}>Salvar senha</Button>
        </form>
      </Card>
    </TelaCentral>
  );
}

function Sair({ compacto = false }: { compacto?: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sair = useMutation({
    mutationFn: () => api("/api/v1/empresa/logout", { method: "POST" }),
    onSettled: async () => {
      queryClient.clear();
      navigate("/login");
    },
  });
  return (
    <button className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-neutral-700 transition duration-200 hover:bg-white hover:shadow-sm" onClick={() => sair.mutate()} title="Sair">
      <LogOut size={18} className="shrink-0" />
      <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${compacto ? "max-w-0 opacity-0" : "max-w-24 opacity-100"}`}>Sair</span>
    </button>
  );
}

function Painel({ titulo, texto, detalhe }: { titulo: string; texto: string; detalhe?: string }) {
  return (
    <Card className="max-w-2xl">
      <h2 className="text-2xl font-extrabold">{titulo}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{texto}</p>
      {detalhe ? <p className="acao acao-purple mt-4 inline-flex">{detalhe}</p> : null}
    </Card>
  );
}

function TelaCentral({ children }: { children: ReactNode }) {
  return <FundoRoxo>{children}</FundoRoxo>;
}

function FundoRoxo({ children, className = "", papel }: { children: ReactNode; className?: string; papel?: "status" }) {
  return (
    <div className={`login-fundo ${className}`} role={papel}>
      <span className="login-orb login-orb-a" aria-hidden="true" />
      <span className="login-orb login-orb-b" aria-hidden="true" />
      <span className="login-orb login-orb-c" aria-hidden="true" />
      <div className="login-fundo-conteudo">{children}</div>
    </div>
  );
}

function iconeDe(label: string): LucideIcon {
  const texto = label.toLowerCase();
  if (texto.includes("dashboard") || texto.includes("início") || texto.includes("inicio")) return LayoutDashboard;
  if (texto.includes("ponto")) return Clock;
  if (texto.includes("avalia") || texto.includes("relat")) return Gauge;
  if (texto.includes("treinamento")) return GraduationCap;
  if (texto.includes("recrut") || texto.includes("usuár") || texto.includes("usuar") || texto.includes("talento")) return Users;
  if (texto.includes("pessoal") || texto.includes("vaga") || texto.includes("colabor")) return Briefcase;
  if (texto.includes("financ") || texto.includes("holerite") || texto.includes("fatura")) return Wallet;
  if (texto.includes("setup")) return Settings;
  if (texto.includes("empresa")) return Building2;
  return Circle;
}

function achar(itens: ItemMenu[], link: string): ItemMenu | null {
  for (const item of itens) {
    if (item.link === link) return item;
    const filho = achar(item.children, link);
    if (filho) return filho;
  }
  return null;
}
