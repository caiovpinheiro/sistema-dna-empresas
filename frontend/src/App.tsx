import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, Check, ChevronDown, Circle, Clock, Gauge, GraduationCap, LayoutDashboard, LogOut, Menu, Settings, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Field, Input, Select } from "./components/ui";
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
  const link = params.get("link");
  const itens = menu.data?.data ?? [];
  const atual = link ? achar(itens, link) : null;
  const empresa = sessao.empresas.find((item) => item.id === sessao.empresaId)?.nome;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[290px_1fr]">
      {aberto ? <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-[#24182d]/40 md:hidden" onClick={() => setAberto(false)} /> : null}
      <aside className={`${aberto ? "fixed inset-y-0 z-50 flex w-72" : "hidden"} flex-col bg-gradient-to-b from-[#7d5b99] to-[#4c3262] text-white md:static md:flex md:min-h-screen`}>
        <div className="border-b border-white/15 px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white font-extrabold text-purple-brand">DW</span>
            <div>
              <p className="text-xs font-bold tracking-wide uppercase text-white/70">DNAWORK</p>
              <h1 className="text-lg font-extrabold leading-5">Empresas</h1>
            </div>
            <button className="ml-auto rounded-xl p-2 hover:bg-white/10 md:hidden" aria-label="Fechar" onClick={() => setAberto(false)}><X size={18} /></button>
          </div>
          <p className="mt-4 text-sm text-white/80">{sessao.nome}</p>
          <EmpresaSelect empresas={sessao.empresas} atual={sessao.empresaId} />
        </div>
        <nav className="flex-1 overflow-auto px-3 py-4" aria-label="Menu da empresa">
          {menu.isLoading ? <p className="px-2 text-sm text-white/70">Carregando menu…</p> : null}
          {menu.isError ? <p className="px-2 text-sm">{menu.error instanceof ApiError ? menu.error.message : "Não foi possível carregar o menu."}</p> : null}
          {!menu.isLoading && !menu.isError && itens.length === 0 ? <p className="px-2 text-sm text-white/70">Nenhuma opção liberada para este usuário.</p> : null}
          <ul className="grid gap-1">
            {itens.map((item) => <Ramo key={item.id} item={item} ativo={link} onNavigate={() => setAberto(false)} />)}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-slate-100 active:scale-95 md:hidden" aria-label="Abrir menu" onClick={() => setAberto(true)}><Menu size={18} /></button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-600">{empresa}</p>
          <Sair />
        </header>
        <main className="mx-auto max-w-5xl px-5 py-6 md:px-8">
          {link && !atual ? (
            <Painel titulo="Opção não liberada" texto="Esta tela não faz parte das opções deste usuário." />
          ) : atual ? (
            <Painel titulo={atual.label} texto="Esta é a mesma opção do portal que a empresa já acessa. A tela desta função entra na sequência, com o mesmo nome." detalhe={atual.link ?? undefined} />
          ) : (
            <Painel titulo="Início" texto="O menu ao lado é o que esta empresa e este usuário já têm liberado: mesmos nomes, mesma ordem e os módulos de recrutamento, ponto e desempenho." />
          )}
        </main>
      </div>
    </div>
  );
}

function Ramo({ item, ativo, onNavigate, nivel = 0 }: { item: ItemMenu; ativo: string | null; onNavigate: () => void; nivel?: number }) {
  const [open, setOpen] = useState(true);
  const Icon = iconeDe(item.label);
  if (item.link) {
    const href = item.link === "principal.php" ? "/" : `/opcao?link=${encodeURIComponent(item.link)}`;
    const marcado = item.link === "principal.php" ? !ativo : ativo === item.link;
    return (
      <li>
        <Link to={href} onClick={onNavigate} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition duration-200 active:scale-[0.98] ${marcado ? "bg-white text-purple-brand shadow-[inset_3px_0_0_#6a4b84]" : "text-white/90 hover:translate-x-1 hover:bg-white/15 hover:text-white"}`}>
          {nivel === 0 ? <Icon size={18} /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
          {item.label}
        </Link>
      </li>
    );
  }
  return (
    <li className="grid gap-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/90 transition duration-200 hover:translate-x-1 hover:bg-white/15 active:scale-[0.98]">
        <Icon size={18} />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown size={16} className={`transition duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {open ? (
        <ul className="nav-sub grid gap-1 pl-7">
          {item.children.map((filho) => <Ramo key={filho.id} item={filho} ativo={ativo} onNavigate={onNavigate} nivel={nivel + 1} />)}
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
    <Select className="mt-3" value={atual} onChange={(event) => trocar.mutate(event.target.value)} aria-label="Empresa">
      {empresas.map((empresa) => <option key={empresa.id} value={empresa.id} className="text-slate-900">{empresa.nome}</option>)}
    </Select>
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
      <div className="login-veil" role="status">
        <div className="login-ok">
          <span className="login-badge">
            <span className="login-ring" />
            <Check size={36} strokeWidth={2.6} />
          </span>
          <p className="login-title">Login realizado</p>
          <p className="login-sub">{entrou}</p>
        </div>
      </div>
    );
  }
  return (
    <TelaCentral>
      <Card className="w-full max-w-md p-8 hover:translate-y-0">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-purple-brand font-extrabold text-white">DW</span>
          <div>
            <p className="text-xs font-bold tracking-wide uppercase text-purple-brand">DNAWORK</p>
            <h1 className="text-2xl font-extrabold">Acesso da empresa</h1>
          </div>
        </div>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setErro(""); login.mutate(); }}>
          <Field label="E-mail"><Input type="text" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Senha"><Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
          <Button type="submit" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</Button>
        </form>
      </Card>
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

function Sair() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sair = useMutation({
    mutationFn: () => api("/api/v1/empresa/logout", { method: "POST" }),
    onSettled: async () => {
      queryClient.clear();
      navigate("/login");
    },
  });
  return <Button variant="ghost" onClick={() => sair.mutate()}><LogOut size={16} /> Sair</Button>;
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
  return <div className="grid min-h-screen place-items-center bg-gradient-to-b from-[#7d5b99] to-[#4c3262] px-4">{children}</div>;
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
