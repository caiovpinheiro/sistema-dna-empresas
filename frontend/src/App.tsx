import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
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
  const link = params.get("link");
  const itens = menu.data?.data ?? [];
  const atual = link ? achar(itens, link) : null;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[290px_1fr]">
      <aside className="bg-purple-brand text-white md:min-h-screen">
        <div className="border-b border-white/15 px-5 py-5">
          <p className="text-xs font-bold tracking-wide uppercase text-white/70">DNAWORK</p>
          <h1 className="text-lg font-extrabold">Empresas</h1>
          <p className="mt-2 text-sm text-white/80">{sessao.nome}</p>
          <EmpresaSelect empresas={sessao.empresas} atual={sessao.empresaId} />
        </div>
        <nav className="px-3 py-4" aria-label="Menu da empresa">
          {menu.isLoading ? <p className="px-2 text-sm text-white/70">Carregando menu…</p> : null}
          {menu.isError ? <p className="px-2 text-sm">{menu.error instanceof ApiError ? menu.error.message : "Não foi possível carregar o menu."}</p> : null}
          {!menu.isLoading && !menu.isError && itens.length === 0 ? <p className="px-2 text-sm text-white/70">Nenhuma opção liberada para este usuário.</p> : null}
          <ul className="grid gap-1">
            {itens.map((item) => <Ramo key={item.id} item={item} ativo={link} />)}
          </ul>
        </nav>
      </aside>
      <main className="px-5 py-6 md:px-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">{sessao.empresas.find((empresa) => empresa.id === sessao.empresaId)?.nome}</p>
          <Sair />
        </div>
        {link && !atual ? (
          <Painel titulo="Opção não liberada" texto="Esta tela não faz parte das opções deste usuário." />
        ) : atual ? (
          <Painel
            titulo={atual.label}
            texto="Esta é a mesma opção do portal que a empresa já acessa. A tela desta função entra na sequência, com o mesmo nome."
            detalhe={atual.link ?? undefined}
          />
        ) : (
          <Painel
            titulo="Início"
            texto="O menu ao lado é o que esta empresa e este usuário já têm liberado: mesmos nomes, mesma ordem e os módulos de recrutamento, ponto e desempenho."
          />
        )}
      </main>
    </div>
  );
}

function Ramo({ item, ativo }: { item: ItemMenu; ativo: string | null }) {
  const aberto = !item.link;
  if (item.link) {
    const href = item.link === "principal.php" ? "/" : `/opcao?link=${encodeURIComponent(item.link)}`;
    const marcado = item.link === "principal.php" ? !ativo : ativo === item.link;
    return (
      <li>
        <Link to={href} className={`block rounded-xl px-3 py-2 text-sm font-semibold ${marcado ? "bg-white text-purple-brand" : "text-white/90 hover:bg-white/10"}`}>
          {item.label}
        </Link>
      </li>
    );
  }
  return (
    <li className="pt-2">
      <p className="px-3 py-1 text-xs font-bold tracking-wide uppercase text-white/60">{item.label}</p>
      {aberto ? <ul className="mt-1 grid gap-1">{item.children.map((filho) => <Ramo key={filho.id} item={filho} ativo={ativo} />)}</ul> : null}
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
    <select
      className="mt-3 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm"
      value={atual}
      onChange={(event) => trocar.mutate(event.target.value)}
      aria-label="Empresa"
    >
      {empresas.map((empresa) => <option key={empresa.id} value={empresa.id} className="text-slate-900">{empresa.nome}</option>)}
    </select>
  );
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: () => api("/api/v1/empresa/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessao-empresa"] });
      navigate("/");
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Falha no login."),
  });
  return (
    <TelaCentral>
      <form className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl" onSubmit={(event) => { event.preventDefault(); setErro(""); login.mutate(); }}>
        <p className="text-xs font-bold tracking-wide uppercase text-purple-brand">DNAWORK</p>
        <h1 className="mt-1 text-2xl font-extrabold">Acesso da empresa</h1>
        <label className="mt-6 block text-sm font-semibold">E-mail
          <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" type="text" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="mt-4 block text-sm font-semibold">Senha
          <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {erro ? <p className="mt-3 text-sm text-rose-600" role="alert">{erro}</p> : null}
        <button className="mt-6 w-full rounded-xl bg-purple-brand px-4 py-2.5 font-bold text-white disabled:opacity-60" disabled={login.isPending}>
          {login.isPending ? "Entrando…" : "Entrar"}
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
      <form className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl" onSubmit={(event) => {
        event.preventDefault();
        if (password !== confirma) { setErro("As senhas não conferem."); return; }
        setErro("");
        salvar.mutate();
      }}>
        <h1 className="text-2xl font-extrabold">Atualize sua senha</h1>
        <p className="mt-2 text-sm text-slate-500">O acesso da empresa pede uma senha nova, como no portal atual.</p>
        <label className="mt-6 block text-sm font-semibold">Nova senha
          <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="mt-4 block text-sm font-semibold">Confirmar
          <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" type="password" minLength={6} required value={confirma} onChange={(event) => setConfirma(event.target.value)} />
        </label>
        {erro ? <p className="mt-3 text-sm text-rose-600" role="alert">{erro}</p> : null}
        <button className="mt-6 w-full rounded-xl bg-purple-brand px-4 py-2.5 font-bold text-white" disabled={salvar.isPending}>Salvar senha</button>
      </form>
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
  return <button className="rounded-xl px-3 py-2 text-sm font-bold text-purple-brand" onClick={() => sair.mutate()}>Sair</button>;
}

function Painel({ titulo, texto, detalhe }: { titulo: string; texto: string; detalhe?: string }) {
  return (
    <section className="max-w-2xl rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-extrabold">{titulo}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{texto}</p>
      {detalhe ? <p className="mt-4 text-xs text-slate-400">{detalhe}</p> : null}
    </section>
  );
}

function TelaCentral({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-purple-brand px-4">{children}</div>;
}

function achar(itens: ItemMenu[], link: string): ItemMenu | null {
  for (const item of itens) {
    if (item.link === link) return item;
    const filho = achar(item.children, link);
    if (filho) return filho;
  }
  return null;
}
