import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, ChevronDown, Circle, Clock, Gauge, GraduationCap, LayoutDashboard, Lock, LogOut, Menu, Settings, User, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Consulta, Faturas, Inicio } from "./pages/consultas";
import { CargaNova, ColaboradorNovo, EscalaNova, FeriadoNovo, Formulario, Listagem, RelatorioPonto, VagaNova } from "./pages/ponto";
import { PontoLoginPage, PontoPage } from "./pages/ponto-colaborador";
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
          <Route path="/ponto/login" element={<PontoLoginPage />} />
          <Route path="/ponto" element={<PontoPage />} />
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
      <Route path="/colaboradores" element={<Portal sessao={dados} />} />
      <Route path="/colaboradores/novo" element={<Portal sessao={dados} />} />
      <Route path="/escalas" element={<Portal sessao={dados} />} />
      <Route path="/escalas/nova" element={<Portal sessao={dados} />} />
      <Route path="/cargas" element={<Portal sessao={dados} />} />
      <Route path="/cargas/nova" element={<Portal sessao={dados} />} />
      <Route path="/feriados" element={<Portal sessao={dados} />} />
      <Route path="/feriados/novo" element={<Portal sessao={dados} />} />
      <Route path="/ponto/relatorio" element={<Portal sessao={dados} />} />
      <Route path="/vagas" element={<Portal sessao={dados} />} />
      <Route path="/vagas/nova" element={<Portal sessao={dados} />} />
      <Route path="/faturas" element={<Portal sessao={dados} />} />
      <Route path="/talentos" element={<Portal sessao={dados} />} />
      <Route path="/talentos/novo" element={<Portal sessao={dados} />} />
      <Route path="/relatorios/encaminhamentos" element={<Portal sessao={dados} />} />
      <Route path="/relatorios/documentos" element={<Portal sessao={dados} />} />
      <Route path="/relatorios/seguro" element={<Portal sessao={dados} />} />
      <Route path="/relatorios/calendario" element={<Portal sessao={dados} />} />
      <Route path="/avaliacoes" element={<Portal sessao={dados} />} />
      <Route path="/holerite" element={<Portal sessao={dados} />} />
      <Route path="/empresa" element={<Portal sessao={dados} />} />
      <Route path="/empresa/filial" element={<Portal sessao={dados} />} />
      <Route path="/usuarios" element={<Portal sessao={dados} />} />
      <Route path="/usuarios/novo" element={<Portal sessao={dados} />} />
      <Route path="/contratados" element={<Portal sessao={dados} />} />
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
  const { pathname, search } = useLocation();
  const empresa = sessao.empresas.find((item) => item.id === sessao.empresaId)?.nome;
  const expandido = aberto || hover;

  return (
    <div className="flex min-h-dvh">
      {aberto ? <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-[#24182d]/40 md:hidden" onClick={() => setAberto(false)} /> : null}
      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`${aberto ? "fixed inset-y-0 z-50 flex w-80" : "hidden"} flex-col overflow-x-hidden border-r border-[#efeaf2] bg-white text-[#1c1524] shadow-[inset_3px_0_0_#6a4b84] transition-[width] duration-300 ease-out md:static md:flex md:min-h-screen ${hover ? "md:w-80" : "md:w-[72px]"}`}
      >
        <div className={`flex items-center py-5 ${expandido ? "gap-3 px-5" : "justify-center px-2"}`}>
          <img src="/logo-mono.png" alt="DNA Work" className={`shrink-0 object-contain ${expandido ? "h-10 w-16" : "h-8 w-12"}`} />
          <div className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${expandido ? "w-auto opacity-100" : "w-0 opacity-0"}`}>
            <p className="text-[15px] font-semibold leading-5 text-[#1c1524]">Empresas</p>
          </div>
          <button className={`rounded-xl p-2 hover:bg-black/5 md:hidden ${expandido ? "ml-auto" : "hidden"}`} aria-label="Fechar" onClick={() => setAberto(false)}><X size={18} /></button>
        </div>
        <div className={`overflow-hidden px-4 transition-all duration-300 ${expandido ? "max-h-28 opacity-100" : "max-h-0 opacity-0"}`}>
          <p className="truncate text-sm text-neutral-500">{sessao.nome}</p>
          <EmpresaSelect empresas={sessao.empresas} atual={sessao.empresaId} />
        </div>
        <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3" aria-label="Menu da empresa">
          {menu.isLoading ? <p className="px-2 text-sm text-[#7a6b86]">Carregando menu…</p> : null}
          {menu.isError ? <p className="px-2 text-sm">{menu.error instanceof ApiError ? menu.error.message : "Não foi possível carregar o menu."}</p> : null}
          {!menu.isLoading && !menu.isError && itens.length === 0 ? <p className="px-2 text-sm text-[#7a6b86]">Nenhuma opção liberada para este usuário.</p> : null}
          <ul className="grid gap-1">
            {itens.map((item) => <Ramo key={item.id} item={item} ativo={link} expandido={expandido} onNavigate={() => setAberto(false)} />)}
          </ul>
        </nav>
        <div className="p-2">
          <Sair compacto={!expandido} />
        </div>
      </aside>
      <div className="min-w-0 flex-1 bg-[#f4f2f5]">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 px-4 pt-[env(safe-area-inset-top)] md:px-8">
          <button className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white md:hidden" aria-label="Abrir menu" onClick={() => setAberto(true)}><Menu size={18} /></button>
          <p className="min-w-0 flex-1 truncate text-sm text-[#6f6578]">{empresa}</p>
          <p className="hidden truncate text-sm text-[#1c1524] sm:block">{sessao.nome}</p>
        </header>
        <main className="mx-auto w-full max-w-5xl overflow-x-hidden px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-8">
          {pathname === "/colaboradores" ? <Consulta titulo="Colaboradores" caminho="/api/v1/empresa/colaboradores" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cargo", titulo: "Cargo" }, { chave: "contrato", titulo: "Contrato" }, { chave: "datainicio", titulo: "Início" }, { chave: "email", titulo: "E-mail" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/colaboradores/novo" ? <ColaboradorNovo /> : null}
          {pathname === "/escalas" ? <Listagem titulo="Escalas" caminho="/api/v1/empresa/escalas" novo="/escalas/nova" colunas={[{ chave: "nome", titulo: "Nome" }]} /> : null}
          {pathname === "/escalas/nova" ? <EscalaNova /> : null}
          {pathname === "/cargas" ? <Listagem titulo="Cargas horárias" caminho="/api/v1/empresa/cargas" novo="/cargas/nova" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "tipo", titulo: "Tipo" }, { chave: "entrada", titulo: "Entrada" }, { chave: "saida", titulo: "Saída" }]} /> : null}
          {pathname === "/cargas/nova" ? <CargaNova /> : null}
          {pathname === "/feriados" ? <Listagem titulo="Feriados" caminho="/api/v1/empresa/feriados" novo="/feriados/novo" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "data", titulo: "Data" }]} /> : null}
          {pathname === "/feriados/novo" ? <FeriadoNovo /> : null}
          {pathname === "/ponto/relatorio" ? <RelatorioPonto /> : null}
          {pathname === "/vagas/nova" ? <VagaNova tipo={new URLSearchParams(search).get("tipo") ?? "2"} /> : null}
          {pathname === "/talentos" ? <Listagem titulo="Banco de talentos" caminho="/api/v1/empresa/talentos" novo="/talentos/novo" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cpf", titulo: "CPF" }, { chave: "email", titulo: "E-mail" }, { chave: "cidade", titulo: "Cidade" }]} /> : null}
          {pathname === "/talentos/novo" ? <Formulario titulo="Cadastrar talento" destino="/api/v1/empresa/talentos" voltar="/talentos" campos={[["nome", "Nome", "text"], ["cpf", "CPF", "text"], ["email", "E-mail", "email"], ["celular", "Celular", "text"], ["cidade", "Cidade", "text"]]} /> : null}
          {pathname === "/relatorios/encaminhamentos" ? <Listagem titulo="Candidatos encaminhados" caminho="/api/v1/empresa/encaminhamentos" novo="/vagas" colunas={[{ chave: "nome", titulo: "Candidato" }, { chave: "cargo", titulo: "Vaga" }, { chave: "data", titulo: "Data" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/relatorios/documentos" ? <Listagem titulo="Documentos" caminho="/api/v1/empresa/documentos" novo="/colaboradores" colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "documentos", titulo: "Arquivos" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/relatorios/seguro" ? <Listagem titulo="Seguro de vida" caminho="/api/v1/empresa/seguro" novo="/colaboradores" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cargo", titulo: "Cargo" }, { chave: "inicio", titulo: "Início" }]} /> : null}
          {pathname === "/relatorios/calendario" ? <Listagem titulo="Calendário" caminho="/api/v1/empresa/calendario" novo="/vagas" colunas={[{ chave: "nome", titulo: "Candidato" }, { chave: "cargo", titulo: "Vaga" }, { chave: "data", titulo: "Data" }, { chave: "hora", titulo: "Hora" }]} /> : null}
          {pathname === "/avaliacoes" ? <Listagem titulo="Avaliações" caminho="/api/v1/empresa/avaliacoes" novo="/colaboradores" colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "ciclo", titulo: "Ciclo" }, { chave: "area", titulo: "Área" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/holerite" ? <Listagem titulo="Holerites" caminho="/api/v1/empresa/holerites" novo="/colaboradores" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cargo", titulo: "Cargo" }, { chave: "competencia", titulo: "Competência" }, { chave: "bruto", titulo: "Bruto" }, { chave: "liquido", titulo: "Líquido" }]} /> : null}
          {pathname === "/usuarios" ? <Listagem titulo="Usuários" caminho="/api/v1/empresa/usuarios" novo="/usuarios/novo" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "email", titulo: "E-mail" }, { chave: "telefone", titulo: "Telefone" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/usuarios/novo" ? <Formulario titulo="Cadastrar usuário" destino="/api/v1/empresa/usuarios" voltar="/usuarios" campos={[["nome", "Nome", "text"], ["email", "E-mail", "email"], ["telefone", "Telefone", "text"], ["senha", "Senha", "password"]]} /> : null}
          {pathname === "/empresa/filial" ? <Formulario titulo="Cadastrar filial" destino="/api/v1/empresa/filiais" voltar="/empresa" campos={[["nome", "Nome", "text"], ["cnpj", "CNPJ", "text"], ["email", "E-mail", "email"], ["cidade", "Cidade", "text"]]} /> : null}
          {pathname === "/empresa" ? <EmpresaDados /> : null}
          {pathname === "/faturas" ? <Faturas /> : null}
          {pathname === "/vagas" ? <Consulta titulo="Vagas" caminho="/api/v1/empresa/vagas" colunas={[{ chave: "cargo", titulo: "Cargo" }, { chave: "contrato", titulo: "Contrato" }, { chave: "cidade", titulo: "Cidade" }, { chave: "situacao", titulo: "Situação" }, { chave: "dataabertura", titulo: "Abertura" }]} /> : null}
          {pathname === "/contratados" ? <Consulta titulo="Contratados" caminho="/api/v1/empresa/contratados" colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cargo", titulo: "Cargo" }, { chave: "contrato", titulo: "Contrato" }, { chave: "inicio", titulo: "Início" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/" ? <Inicio acessos={acessosLiberados(itens)} /> : null}
          {pathname === "/opcao" && link && !atual ? <Painel titulo="Opção não liberada" texto="Esta tela não faz parte das opções deste usuário." /> : null}
          {pathname === "/opcao" && atual ? <Painel titulo={atual.label} texto="Esta opção ainda será ligada. O nome é o mesmo do portal que a empresa já usa." detalhe={atual.link ?? undefined} /> : null}
        </main>
      </div>
    </div>
  );
}

function Ramo({ item, ativo, expandido, onNavigate, nivel = 0 }: { item: ItemMenu; ativo: string | null; expandido: boolean; onNavigate: () => void; nivel?: number }) {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();
  const Icon = iconeDe(item.label);
  useEffect(() => {
    if (!expandido) setOpen(false);
  }, [expandido]);
  const texto = <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${expandido ? "max-w-56 opacity-100" : "max-w-0 opacity-0"}`}>{item.label}</span>;
  if (item.link) {
    const href = destinoDoLink(item.link);
    const marcado = href.startsWith("/opcao") ? ativo === item.link : href.includes("?") ? pathname + search === href : pathname === href;
    return (
      <li>
        <Link to={href} onClick={onNavigate} title={item.label} className={`flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-medium transition duration-150 ${marcado ? "bg-[#f4eef6] text-[#6a4b84]" : "text-[#3c3344] hover:bg-[#f7f5f8]"}`}>
          {nivel === 0 ? <Icon size={18} className="shrink-0" /> : <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
          {texto}
        </Link>
      </li>
    );
  }
  return (
    <li className="grid gap-1">
      <button type="button" aria-expanded={open && expandido} title={item.label} onClick={() => setOpen((value) => !value)} className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-[13px] font-medium text-[#3c3344] transition duration-150 hover:bg-[#f7f5f8]">
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
    const timer = window.setTimeout(() => navigate("/"), 8000);
    return () => window.clearTimeout(timer);
  }, [entrou, navigate]);
  if (entrou) {
    return (
      <FundoAcesso>
        <div className="grid w-full max-w-xs justify-items-center rounded-[2rem] bg-white px-6 py-8 text-center shadow-2xl" role="status">
          <video
            className="h-40 w-40 rounded-2xl object-contain sm:h-44 sm:w-44"
            src="/login-sucesso.webm"
            autoPlay
            muted
            playsInline
            aria-label={`Login realizado, ${entrou}`}
            onEnded={() => navigate("/")}
          />
          <p className="mt-4 text-lg font-extrabold text-[#1c1524]">Login realizado</p>
          <p className="text-sm text-[#6f6578]">{entrou}</p>
        </div>
      </FundoAcesso>
    );
  }
  return (
    <FundoAcesso>
      <form className="relative w-full max-w-md rounded-[2rem] bg-white px-5 pb-8 pt-16 shadow-[0_24px_50px_rgb(49_10_80_/_18%)] sm:px-8" onSubmit={(event) => { event.preventDefault(); setErro(""); login.mutate(); }}>
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
        <Link to="/ponto/login" className="mt-4 block text-center text-sm font-semibold text-[#5b21b6]">Sou colaborador e quero bater ponto</Link>
      </form>
    </FundoAcesso>
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
    <button className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold text-[#3d2c48] transition duration-150 hover:bg-white" onClick={() => sair.mutate()} title="Sair">
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

function FundoAcesso({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#0a001a]">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <span className="aurora-blob aurora-blob-a" />
        <span className="aurora-blob aurora-blob-b" />
        <span className="aurora-blob aurora-blob-c" />
      </div>
      <div className="login-fundo-conteudo">{children}</div>
    </div>
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

function EmpresaDados() {
  const dados = useQuery({ queryKey: ["empresa-dados"], queryFn: () => api<{ nome: string; cnpj: string | null; email: string | null; cidade: string | null; filiais: Array<{ nome: string; cnpj: string | null; cidade: string | null }> }>("/api/v1/empresa/empresa") });
  const empresa = dados.data?.data;
  const navigate = useNavigate();
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">{empresa?.nome || "Empresa"}</h2>
          <p className="text-sm text-slate-500">{[empresa?.cnpj, empresa?.cidade, empresa?.email].filter(Boolean).join(" · ")}</p>
        </div>
        <button className="rounded-xl bg-[#5b21b6] px-4 py-2 text-sm font-bold text-white" onClick={() => navigate("/empresa/filial")}>Cadastrar filial</button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-400"><tr><th className="px-4 py-3">Filial</th><th>CNPJ</th><th>Cidade</th></tr></thead>
          <tbody>
            {(empresa?.filiais ?? []).map((filial) => (
              <tr key={filial.nome} className="border-t border-slate-100"><td className="px-4 py-3">{filial.nome}</td><td>{filial.cnpj || "—"}</td><td>{filial.cidade || "—"}</td></tr>
            ))}
          </tbody>
        </table>
        {!dados.isLoading && (empresa?.filiais.length ?? 0) === 0 ? <p className="px-4 py-6 text-sm text-slate-500">Nenhuma filial cadastrada.</p> : null}
      </div>
    </section>
  );
}

function acessosLiberados(itens: ItemMenu[]) {
  const nomes = new Map<string, string>([
    ["/colaboradores", "Colaboradores"],
    ["/vagas", "Vagas"],
    ["/ponto/relatorio", "Ponto"],
    ["/faturas", "Faturas"],
    ["/relatorios/encaminhamentos", "Encaminhados"],
    ["/relatorios/documentos", "Documentos"],
    ["/relatorios/seguro", "Seguro"],
    ["/relatorios/calendario", "Calendário"],
  ]);
  const achados: Array<{ href: string; label: string }> = [];
  const visitar = (lista: ItemMenu[]) => {
    for (const item of lista) {
      if (item.link) {
        const href = destinoDoLink(item.link);
        const label = nomes.get(href);
        if (label && !achados.some((acesso) => acesso.href === href)) achados.push({ href, label });
      }
      if (item.children.length) visitar(item.children);
    }
  };
  visitar(itens);
  return achados;
}

function destinoDoLink(link: string): string {
  const [base, query] = link.split("?");
  const tipo = new URLSearchParams(query ?? "").get("Tipo");
  if (base === "principal.php") return "/";
  if (base === "buscar-candidato-ponto.php") return "/colaboradores";
  if (base === "cadastrar-colaborador.php") return "/colaboradores/novo";
  if (base === "buscar-escala.php") return "/escalas";
  if (base === "cadastrar-escala.php") return "/escalas/nova";
  if (base === "buscar-carga-horaria.php") return "/cargas";
  if (base === "cadastrar-carga-horaria.php") return "/cargas/nova";
  if (base === "buscar-feriado.php") return "/feriados";
  if (base === "cadastrar-feriado.php") return "/feriados/novo";
  if (base === "relatorio-ponto-em-massa.php") return "/ponto/relatorio";
  if (base === "buscar-faturas.php") return "/faturas";
  if (base === "buscar-vagas.php") return "/vagas";
  if (base === "buscar-candidato.php") return "/colaboradores";
  if (base === "banco-de-talentos.php") return "/talentos";
  if (base === "cadastrar-candidato.php") return "/talentos/novo";
  if (base === "relatorio-encaminhamento.php") return "/relatorios/encaminhamentos";
  if (base === "relatorio-documento-pendente.php") return "/relatorios/documentos";
  if (base === "relatorio-seguro-de-vida.php") return "/relatorios/seguro";
  if (base === "calendario-operador.php") return "/relatorios/calendario";
  if (base === "criar-avaliacao.php") return "/avaliacoes";
  if (base === "holerite.php") return "/holerite";
  if (base === "buscar-empresa.php") return "/empresa";
  if (base === "cadastrar-empresa-filial.php") return "/empresa/filial";
  if (base === "buscar-usuario.php") return "/usuarios";
  if (base === "cadastrar-usuario.php") return "/usuarios/novo";
  if (base === "cadastrar-vaga.php" && tipo === "4") return "/vagas/nova?tipo=4";
  if (base === "cadastrar-vaga.php") return "/vagas/nova?tipo=2";
  return `/opcao?link=${encodeURIComponent(link)}`;
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
