import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, ChevronDown, Circle, Clock, Gauge, GraduationCap, LayoutDashboard, Lock, LogOut, Menu, Plus, Settings, User, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CadastroPage } from "./pages/cadastro";
import { Consulta, Faturas, Ficha, Inicio } from "./pages/consultas";
import { CargaNova, ColaboradorNovo, ColaboradoresPonto, EscalaNova, FeriadoNovo, Formulario, Listagem, RelatorioPonto, RelatorioPontoColaborador } from "./pages/ponto";
import { VagaNova, VagasPage, linkAbrirVaga, type TipoVaga } from "./pages/vagas";
import { PontoLoginPage, PontoPage } from "./pages/ponto-colaborador";
import { Alerta, Button, CabecalhoPagina, Card, Empty, Field, Input, Skeleton, botao } from "./components/ui";
import { iniciais } from "./lib/formato";
import { FundoLiquido } from "./components/fundo-liquido";
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
          <Route path="/cadastro" element={<CadastroPage />} />
          <Route path="/ponto/login" element={<PontoLoginPage />} />
          <Route path="/ponto" element={<PontoPage />} />
          <Route path="/*" element={<Protegido />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** Telas do portal. Qualquer outro caminho volta para o /dashboard. */
const ROTAS = [
  "/dashboard", "/colaboradores", "/colaboradores/novo", "/colaboradores/:id",
  "/escalas", "/escalas/nova", "/escalas/:id", "/cargas", "/cargas/nova", "/cargas/:id",
  "/feriados", "/feriados/novo", "/feriados/:id",
  "/ponto/colaboradores", "/ponto/colaborador/:id", "/ponto/relatorio",
  "/vagas", "/vagas/nova", "/vagas/:id", "/faturas", "/faturas/:id",
  "/talentos", "/talentos/novo", "/talentos/:id",
  "/relatorios/encaminhamentos", "/relatorios/encaminhamentos/:id", "/relatorios/documentos", "/relatorios/documentos/:id",
  "/relatorios/seguro", "/relatorios/seguro/:id", "/relatorios/calendario", "/relatorios/calendario/:id",
  "/avaliacoes", "/avaliacoes/:id", "/holerite", "/holerite/:id",
  "/empresa", "/empresa/filial", "/usuarios", "/usuarios/novo", "/usuarios/:id",
  "/contratados", "/contratados/:id", "/opcao",
];

function Protegido() {
  const sessao = useQuery({ queryKey: ["sessao-empresa"], queryFn: () => api<Sessao>("/api/v1/empresa/sessao") });
  if (sessao.isLoading) return <TelaCentral>Carregando sessão…</TelaCentral>;
  if (sessao.isError || !sessao.data) return <Navigate to="/login" replace />;
  const dados = sessao.data.data;
  if (dados.mustChangePassword) return <SenhaPage />;
  return (
    <Routes>
      {ROTAS.map((rota) => <Route key={rota} path={rota} element={<Portal sessao={dados} />} />)}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
  const tipos = tiposDeVaga(itens);
  const abrirVaga = linkAbrirVaga(tipos);
  const tipoUrl = new URLSearchParams(search).get("tipo") ?? "2";
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    setAberto(false);
    main.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname, search]);

  const nav = (expandido: boolean, fechar: () => void) => (
    <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2" aria-label="Menu da empresa">
      <ul className="grid gap-1">
        <li>
          <ItemLink href="/dashboard" label="Início" icone={LayoutDashboard} ativo={pathname === "/dashboard"} expandido={expandido} onNavigate={fechar} />
        </li>
        {menu.isLoading ? <li className="px-3 py-2 text-xs text-slate-500">{expandido ? "Carregando menu…" : ""}</li> : null}
        {menu.isError && expandido ? <li className="px-3 py-2 text-xs text-rose-300">{menu.error instanceof ApiError ? menu.error.message : "Não foi possível carregar o menu."}</li> : null}
        {itens.filter((item) => !(item.link && destinoDoLink(item.link) === "/dashboard")).map((item) => <Ramo key={item.id} item={item} ativo={link} expandido={expandido} onNavigate={fechar} />)}
      </ul>
    </nav>
  );

  return (
    <div className="app-canvas flex min-h-dvh bg-[#f3f1f7]">
      {/* Computador: barra estreita que abre por cima do conteúdo ao passar o mouse. */}
      <div className="relative hidden w-[76px] shrink-0 lg:block">
        <aside
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className={`fixed inset-y-0 left-0 z-40 flex flex-col overflow-x-hidden border-r border-white/10 bg-[#130d19] text-white transition-[width] duration-300 ease-out ${hover ? "w-72 shadow-2xl" : "w-[76px]"}`}
        >
          <Marca expandido={hover} />
          {hover ? <div className="px-3 pb-2"><EmpresaSelect empresas={sessao.empresas} atual={sessao.empresaId} /></div> : null}
          {nav(hover, () => setHover(false))}
          <div className="border-t border-white/10 p-2">
            <Sair compacto={!hover} />
            {hover ? <p className="truncate px-3 pt-1 text-xs text-slate-500">{sessao.email}</p> : null}
          </div>
        </aside>
      </div>

      {/* Celular e tablet: gaveta. */}
      {aberto ? <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-[#130d19]/50 lg:hidden" onClick={() => setAberto(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] flex-col border-r border-white/10 bg-[#130d19] pb-[env(safe-area-inset-bottom)] text-white lg:hidden ${aberto ? "flex" : "hidden"}`}>
        <div className="flex items-center justify-between pr-3">
          <Marca expandido />
          <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10" aria-label="Fechar menu" onClick={() => setAberto(false)}><X size={18} /></button>
        </div>
        <div className="px-3 pb-2"><EmpresaSelect empresas={sessao.empresas} atual={sessao.empresaId} /></div>
        {nav(true, () => setAberto(false))}
        <div className="border-t border-white/10 p-2">
          <Sair />
          <p className="truncate px-3 pt-1 text-xs text-slate-500">{sessao.email}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:px-6">
          <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menu" onClick={() => setAberto(true)}><Menu size={18} /></button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{tituloDaRota(pathname, atual?.label)}</p>
          <p className="hidden max-w-[40%] truncate text-sm text-slate-500 md:block">{empresa}</p>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-bold text-violet-800" title={sessao.nome}>{iniciais(sessao.nome)}</span>
        </header>
        <main ref={main} className="mx-auto w-full max-w-6xl flex-1 overflow-x-hidden px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-5 md:px-6 md:pt-6">
          <div key={pathname} className="motion-pop min-w-0">
          {pathname === "/dashboard" ? <Inicio acessos={acessosLiberados(itens)} nome={sessao.nome} abrirVaga={abrirVaga} /> : null}
          {pathname === "/colaboradores" ? <Consulta titulo="Colaboradores" descricao="Quem trabalha ou já trabalhou na empresa pela DNA Work. Clique no nome para ver a ficha." caminho="/api/v1/empresa/colaboradores" filtroStatus singular="colaborador" plural="colaboradores" acoes={temLink(itens, "cadastrar-colaborador.php") ? <Link to="/colaboradores/novo" className={botao("primary", "botao")}><Plus size={16} /> Cadastrar colaborador</Link> : null} linkNome={(linha) => linha.id_candidato ? `/colaboradores/${linha.id_candidato}` : null} colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "datainicio", titulo: "Contratação" }, { chave: "departamento", titulo: "Departamento" }, { chave: "cargo", titulo: "Cargo" }, { chave: "modalidade", titulo: "Modalidade" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/colaboradores/novo" ? <ColaboradorNovo /> : null}
          {pathname === "/escalas" ? <Listagem titulo="Escalas" descricao="Horários de cada dia da semana usados no ponto." caminho="/api/v1/empresa/escalas" novo="/escalas/nova" rotuloNovo="Nova escala" singular="escala" plural="escalas" linkNome={(linha) => linha.id ? `/escalas/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Escala" }, { chave: "segunda", titulo: "Segunda" }, { chave: "terca", titulo: "Terça" }, { chave: "quarta", titulo: "Quarta" }, { chave: "quinta", titulo: "Quinta" }, { chave: "sexta", titulo: "Sexta" }, { chave: "sabado", titulo: "Sábado" }, { chave: "domingo", titulo: "Domingo" }]} /> : null}
          {pathname === "/escalas/nova" ? <EscalaNova /> : null}
          {pathname === "/cargas" ? <Listagem titulo="Cargas horárias" descricao="Entrada, intervalo e saída de cada jornada." caminho="/api/v1/empresa/cargas" novo="/cargas/nova" rotuloNovo="Nova carga horária" singular="carga horária" plural="cargas horárias" linkNome={(linha) => linha.id ? `/cargas/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Carga horária" }, { chave: "tipo", titulo: "Tipo" }, { chave: "entrada", titulo: "Entrada" }, { chave: "saida_refeicao", titulo: "Saída refeição" }, { chave: "retorno_refeicao", titulo: "Retorno refeição" }, { chave: "saida", titulo: "Saída" }]} /> : null}
          {pathname === "/cargas/nova" ? <CargaNova /> : null}
          {pathname === "/feriados" ? <Listagem titulo="Feriados" descricao="Dias sem expediente considerados no ponto." caminho="/api/v1/empresa/feriados" novo="/feriados/novo" rotuloNovo="Novo feriado" singular="feriado" plural="feriados" linkNome={(linha) => linha.id ? `/feriados/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "data", titulo: "Data" }]} /> : null}
          {pathname === "/feriados/novo" ? <FeriadoNovo /> : null}
          {pathname === "/ponto/colaboradores" ? <ColaboradoresPonto /> : null}
          {pathname.startsWith("/ponto/colaborador/") ? <RelatorioPontoColaborador id={decodeURIComponent(pathname.slice("/ponto/colaborador/".length))} /> : null}
          {pathname === "/ponto/relatorio" ? <RelatorioPonto /> : null}
          {pathname === "/vagas/nova" && tipoUrl !== "4" ? <VagaNova key={tipoUrl} tipo={tipoUrl} tipos={tipos} /> : null}
          {pathname === "/vagas/nova" && tipoUrl === "4" ? <Navigate to="/vagas" replace /> : null}
          {pathname === "/talentos" ? <Listagem titulo="Banco de talentos" descricao="Pessoas cadastradas pela empresa para futuras vagas." caminho="/api/v1/empresa/talentos" novo="/talentos/novo" rotuloNovo="Cadastrar talento" singular="talento" plural="talentos" linkNome={(linha) => linha.id ? `/talentos/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cidade", titulo: "Cidade" }, { chave: "bairro", titulo: "Bairro" }, { chave: "estado", titulo: "Estado" }, { chave: "ensino", titulo: "Ensino" }, { chave: "curso", titulo: "Curso" }, { chave: "datacadastro", titulo: "Cadastro" }]} /> : null}
          {pathname === "/talentos/novo" ? <Formulario titulo="Cadastrar talento" destino="/api/v1/empresa/talentos" voltar="/talentos" campos={[["nome", "Nome", "text"], ["cpf", "CPF", "text"], ["email", "E-mail", "email"], ["celular", "Celular", "text"], ["cidade", "Cidade", "text"]]} /> : null}
          {pathname === "/relatorios/encaminhamentos" ? <Listagem titulo="Candidatos encaminhados" descricao="Pessoas que a DNA Work enviou para entrevista nas vagas da empresa." caminho="/api/v1/empresa/encaminhamentos" singular="encaminhamento" plural="encaminhamentos" linkNome={(linha) => linha.id ? `/relatorios/encaminhamentos/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Candidato" }, { chave: "cargo", titulo: "Vaga" }, { chave: "data", titulo: "Convocação" }, { chave: "data_entrevista", titulo: "Entrevista" }, { chave: "hora", titulo: "Hora" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/relatorios/documentos" ? <Listagem titulo="Documentos" descricao="Contratos e documentos de cada colaborador." caminho="/api/v1/empresa/documentos" singular="documento" plural="documentos" linkNome={(linha) => linha.id ? `/relatorios/documentos/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "documentos", titulo: "Contrato" }, { chave: "inicio", titulo: "Início" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/relatorios/seguro" ? <Listagem titulo="Seguro de vida" descricao="Colaboradores cobertos pelo seguro e a vigência de cada um." caminho="/api/v1/empresa/seguro" singular="pessoa" plural="pessoas" linkNome={(linha) => linha.id ? `/relatorios/seguro/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cargo", titulo: "Cargo" }, { chave: "cpf", titulo: "CPF" }, { chave: "inicio", titulo: "Início" }, { chave: "fim", titulo: "Fim" }]} /> : null}
          {pathname === "/relatorios/calendario" ? <Listagem titulo="Calendário" descricao="Entrevistas e compromissos marcados nas vagas." caminho="/api/v1/empresa/calendario" singular="compromisso" plural="compromissos" linkNome={(linha) => linha.id ? `/relatorios/calendario/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Compromisso" }, { chave: "cargo", titulo: "Vaga" }, { chave: "data", titulo: "Data" }, { chave: "hora", titulo: "Início" }, { chave: "termino", titulo: "Término" }]} /> : null}
          {pathname === "/avaliacoes" ? <Listagem titulo="Avaliações" descricao="Avaliações de desempenho dos colaboradores." caminho="/api/v1/empresa/avaliacoes" singular="avaliação" plural="avaliações" linkNome={(linha) => linha.id ? `/avaliacoes/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "ciclo", titulo: "Ciclo" }, { chave: "area", titulo: "Área" }, { chave: "data", titulo: "Data" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/holerite" ? <Listagem titulo="Holerites" descricao="Folha de pagamento por colaborador e competência." caminho="/api/v1/empresa/holerites" singular="holerite" plural="holerites" linkNome={(linha) => linha.id ? `/holerite/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "cargo", titulo: "Cargo" }, { chave: "competencia", titulo: "Competência" }, { chave: "bruto", titulo: "Bruto" }, { chave: "liquido", titulo: "Líquido" }]} /> : null}
          {pathname === "/usuarios" ? <Listagem titulo="Usuários" descricao="Quem da empresa acessa este portal." caminho="/api/v1/empresa/usuarios" novo="/usuarios/novo" rotuloNovo="Novo usuário" singular="usuário" plural="usuários" linkNome={(linha) => linha.id ? `/usuarios/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Nome" }, { chave: "email", titulo: "E-mail" }, { chave: "tipo", titulo: "Tipo" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {pathname === "/usuarios/novo" ? <Formulario titulo="Cadastrar usuário" descricao="A pessoa entra no portal com o e-mail e a senha informados aqui." destino="/api/v1/empresa/usuarios" voltar="/usuarios" campos={[["nome", "Nome", "text"], ["email", "E-mail", "email"], ["telefone", "Telefone", "text"], ["senha", "Senha", "password"]]} /> : null}
          {pathname === "/empresa/filial" ? <Formulario titulo="Cadastrar filial" destino="/api/v1/empresa/filiais" voltar="/empresa" campos={[["nome", "Nome", "text"], ["cnpj", "CNPJ", "text"], ["email", "E-mail", "email"], ["cidade", "Cidade", "text"]]} /> : null}
          {pathname === "/empresa" ? <EmpresaDados /> : null}
          {pathname === "/faturas" ? <Faturas /> : null}
          {pathname === "/vagas" ? <VagasPage tipos={tipos} /> : null}
          {pathname === "/contratados" ? <Consulta titulo="Contratados" descricao="Todas as contratações feitas pela DNA Work para a empresa." caminho="/api/v1/empresa/contratados" singular="contratação" plural="contratações" linkNome={(linha) => linha.id ? `/contratados/${linha.id}` : null} colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "inicio", titulo: "Contratação" }, { chave: "departamento", titulo: "Departamento" }, { chave: "cargo", titulo: "Cargo" }, { chave: "contrato", titulo: "Modalidade" }, { chave: "situacao", titulo: "Situação" }]} /> : null}
          {telaInterna(pathname)}
          {pathname === "/opcao" && link && !atual ? <Painel titulo="Opção não liberada" texto="Esta tela não faz parte das opções deste usuário." /> : null}
          {pathname === "/opcao" && atual ? <Painel titulo={atual.label} texto="Esta opção ainda está sendo preparada no portal novo. Se precisar dela agora, fale com a DNA Work." /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function Marca({ expandido }: { expandido: boolean }) {
  return (
    <Link to="/dashboard" className={`flex items-center py-5 ${expandido ? "gap-3 px-4" : "justify-center px-2"}`} title="Início">
      <img src="/logo-mono.png" alt="DNA Work" className={`shrink-0 object-contain ${expandido ? "h-9 w-16" : "h-8 w-12"}`} />
      <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${expandido ? "w-auto opacity-100" : "w-0 opacity-0"}`}>
        <span className="block text-sm font-extrabold tracking-wide text-white">DNAWORK</span>
        <span className="block text-xs text-slate-400">Portal da empresa</span>
      </span>
    </Link>
  );
}

function ItemLink({ href, label, icone: Icone, ativo, expandido, onNavigate, nivel = 0 }: { href: string; label: string; icone: LucideIcon; ativo: boolean; expandido: boolean; onNavigate: () => void; nivel?: number }) {
  return (
    <Link to={href} onClick={onNavigate} title={label} aria-current={ativo ? "page" : undefined}
      className={`relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold transition duration-150 ${ativo ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/[0.07] hover:text-white"}`}>
      {ativo && nivel === 0 ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-violet-400" /> : null}
      {nivel === 0 ? <Icone size={18} className={`shrink-0 ${ativo ? "text-violet-300" : ""}`} /> : <span className={`ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ativo ? "bg-violet-300" : "bg-slate-500"}`} />}
      <span className={`min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ${expandido ? "max-w-56 opacity-100" : "max-w-0 opacity-0"}`}>{label}</span>
    </Link>
  );
}

function Ramo({ item, ativo, expandido, onNavigate, nivel = 0 }: { item: ItemMenu; ativo: string | null; expandido: boolean; onNavigate: () => void; nivel?: number }) {
  const { pathname, search } = useLocation();
  const marcadoEm = (ramo: ItemMenu): boolean => {
    if (ramo.link) {
      const href = destinoDoLink(ramo.link);
      if (href.startsWith("/opcao")) return ativo === ramo.link;
      if (href.includes("?")) return pathname + search === href;
      return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`) && !ramo.children.length && !irmaoMaisExato(href, pathname));
    }
    return ramo.children.some(marcadoEm);
  };
  const [open, setOpen] = useState(() => !item.link && marcadoEm(item));
  const Icon = iconeDe(item.label);
  if (item.link) {
    return <li><ItemLink href={destinoDoLink(item.link)} label={item.label} icone={Icon} ativo={marcadoEm(item)} expandido={expandido} onNavigate={onNavigate} nivel={nivel} /></li>;
  }
  const temAtivo = marcadoEm(item);
  return (
    <li className="grid gap-1">
      <button type="button" aria-expanded={open && expandido} title={item.label} onClick={() => setOpen((value) => !value)}
        className={`flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold transition duration-150 hover:bg-white/[0.07] hover:text-white ${temAtivo ? "text-white" : "text-slate-300"}`}>
        <Icon size={18} className={`shrink-0 ${temAtivo ? "text-violet-300" : ""}`} />
        <span className={`min-w-0 overflow-hidden whitespace-nowrap text-left transition-all duration-300 ${expandido ? "max-w-56 opacity-100" : "max-w-0 opacity-0"}`}>{item.label}</span>
        <ChevronDown size={16} className={`ml-auto shrink-0 transition duration-200 ${expandido ? "" : "w-0 opacity-0"} ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && expandido ? (
        <ul className="nav-sub grid gap-0.5 pl-5">
          {item.children.map((filho) => <Ramo key={filho.id} item={filho} ativo={ativo} expandido={expandido} onNavigate={onNavigate} nivel={nivel + 1} />)}
        </ul>
      ) : null}
    </li>
  );
}

/** /vagas não fica marcado em /vagas/nova quando "Abrir vaga" também está no menu. */
function irmaoMaisExato(href: string, pathname: string) {
  return pathname.endsWith("/nova") || pathname.endsWith("/novo") || (href === "/empresa" && pathname === "/empresa/filial");
}

function EmpresaSelect({ empresas, atual }: { empresas: Empresa[]; atual: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const trocar = useMutation({
    mutationFn: (empresaId: string) => api("/api/v1/empresa/sessao/empresa", { method: "POST", body: JSON.stringify({ empresaId }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      navigate("/dashboard");
    },
  });
  if (empresas.length < 2) {
    const nome = empresas.find((empresa) => empresa.id === atual)?.nome ?? empresas[0]?.nome;
    return nome ? <p className="truncate rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300" title={nome}>{nome}</p> : null;
  }
  return (
    <select className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 outline-none [color-scheme:dark] focus:ring-2 focus:ring-violet-400/40" value={atual} onChange={(event) => trocar.mutate(event.target.value)} aria-label="Empresa" disabled={trocar.isPending}>
      {empresas.map((empresa) => <option key={empresa.id} value={empresa.id} className="bg-[#1c1524]">{empresa.nome}</option>)}
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
    const timer = window.setTimeout(() => navigate("/dashboard"), 8000);
    return () => window.clearTimeout(timer);
  }, [entrou, navigate]);
  if (entrou) {
    return (
      <FundoLiquido>
        <div className="grid w-full max-w-xs justify-items-center rounded-[2rem] bg-white px-6 py-8 text-center shadow-2xl" role="status">
          <video
            className="h-40 w-40 rounded-2xl object-contain sm:h-44 sm:w-44"
            src="/login-sucesso.webm"
            autoPlay
            muted
            playsInline
            aria-label={`Login realizado, ${entrou}`}
            onEnded={() => navigate("/dashboard")}
          />
          <p className="mt-4 text-lg font-extrabold text-[#1c1524]">Login realizado</p>
          <p className="text-sm text-[#6f6578]">{entrou}</p>
        </div>
        </FundoLiquido>
    );
  }
  return (
    <FundoLiquido>
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
        <Link to="/cadastro" className="mt-4 block text-center text-sm font-semibold text-[#5b21b6]">Cadastrar minha empresa</Link>
        <Link to="/ponto/login" className="mt-2 block text-center text-sm font-semibold text-[#5b21b6]">Sou colaborador e quero bater ponto</Link>
      </form>
      </FundoLiquido>
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
      <Card className="w-full max-w-md p-6 sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-700"><Lock size={20} /></span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Crie uma senha nova</h1>
        <p className="mt-1 text-sm text-slate-500">É o primeiro acesso ou a senha foi redefinida. Use pelo menos 6 caracteres.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (password !== confirma) { setErro("As senhas não conferem."); return; }
          setErro("");
          salvar.mutate();
        }}>
          <Field label="Nova senha"><Input type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="Repita a senha"><Input type="password" autoComplete="new-password" minLength={6} required value={confirma} onChange={(event) => setConfirma(event.target.value)} /></Field>
          {erro ? <Alerta>{erro}</Alerta> : null}
          <Button type="submit" className="h-11" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar senha"}</Button>
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
    <button className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold text-slate-300 transition duration-150 hover:bg-white/[0.07] hover:text-white" onClick={() => sair.mutate()} title="Sair">
      <LogOut size={18} className="shrink-0" />
      <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${compacto ? "max-w-0 opacity-0" : "max-w-24 opacity-100"}`}>Sair</span>
    </button>
  );
}

function Painel({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo={titulo} />
      <Empty titulo="Em preparação" texto={texto} acao={<Link to="/dashboard" className={botao("secondary", "botao")}>Voltar ao início</Link>} />
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
  const dados = useQuery({ queryKey: ["empresa-dados"], queryFn: () => api<{ nome: string; razao_social: string | null; cnpj: string | null; email: string | null; telefone: string | null; cidade: string | null; uf: string | null; responsavel: string | null; filiais: Array<{ nome: string; cnpj: string | null; cidade: string | null }> }>("/api/v1/empresa/empresa") });
  const empresa = dados.data?.data;
  const campos: Array<[string, string | null | undefined]> = [
    ["Razão social", empresa?.razao_social], ["CNPJ", empresa?.cnpj], ["Cidade", [empresa?.cidade, empresa?.uf].filter(Boolean).join("/")],
    ["Telefone", empresa?.telefone], ["E-mail", empresa?.email], ["Responsável", empresa?.responsavel],
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo={empresa?.nome || "Empresa"} descricao="Dados cadastrais da empresa e das filiais." acoes={<Link to="/empresa/filial" className={botao("primary", "botao")}><Plus size={16} /> Cadastrar filial</Link>} />
      {dados.isLoading ? <Skeleton className="h-40" /> : null}
      {dados.isError ? <Alerta>{dados.error instanceof ApiError ? dados.error.message : "Não foi possível carregar os dados da empresa."}</Alerta> : null}
      {empresa ? (
        <Card className="p-0">
          <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
            {campos.map(([rotulo, valor]) => (
              <div key={rotulo} className="border-b border-slate-100 px-4 py-3">
                <dt className="text-xs font-medium text-slate-500">{rotulo}</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold text-ink">{valor || "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
      {empresa ? (
        <section className="grid gap-3">
          <h2 className="text-base font-bold text-ink">Filiais</h2>
          {empresa.filiais.length ? (
            <Card className="p-0">
              <ul className="divide-y divide-slate-100">
                {empresa.filiais.map((filial) => (
                  <li key={`${filial.nome}-${filial.cnpj}`} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600"><Building2 size={16} /></span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{filial.nome}</p>
                      <p className="text-xs text-slate-500">{[filial.cnpj, filial.cidade].filter(Boolean).join(" · ") || "Sem CNPJ e cidade"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : <Empty titulo="Nenhuma filial cadastrada" texto="Cadastre as filiais para separar colaboradores e vagas por unidade." />}
        </section>
      ) : null}
    </div>
  );
}

function telaInterna(pathname: string) {
  const regras: Array<[RegExp, string, string]> = [
    [/^\/colaboradores\/(?!novo$)([^/]+)$/, "colaborador", "/colaboradores"],
    [/^\/contratados\/([^/]+)$/, "contratado", "/contratados"],
    [/^\/vagas\/(?!nova$)([^/]+)$/, "vaga", "/vagas"],
    [/^\/talentos\/(?!novo$)([^/]+)$/, "talento", "/talentos"],
    [/^\/escalas\/(?!nova$)([^/]+)$/, "escala", "/escalas"],
    [/^\/cargas\/(?!nova$)([^/]+)$/, "carga", "/cargas"],
    [/^\/feriados\/(?!novo$)([^/]+)$/, "feriado", "/feriados"],
    [/^\/usuarios\/(?!novo$)([^/]+)$/, "usuario", "/usuarios"],
    [/^\/holerite\/([^/]+)$/, "holerite", "/holerite"],
    [/^\/faturas\/([^/]+)$/, "fatura", "/faturas"],
    [/^\/relatorios\/encaminhamentos\/([^/]+)$/, "encaminhamento", "/relatorios/encaminhamentos"],
    [/^\/relatorios\/documentos\/([^/]+)$/, "documento", "/relatorios/documentos"],
    [/^\/relatorios\/seguro\/([^/]+)$/, "seguro", "/relatorios/seguro"],
    [/^\/relatorios\/calendario\/([^/]+)$/, "calendario", "/relatorios/calendario"],
    [/^\/avaliacoes\/([^/]+)$/, "avaliacao", "/avaliacoes"],
  ];
  for (const [regra, tipo, voltar] of regras) {
    const achou = pathname.match(regra);
    if (achou?.[1]) return <Ficha caminho={`/api/v1/empresa/detalhe/${tipo}/${encodeURIComponent(achou[1])}`} voltar={voltar} rotuloVoltar={tituloDaRota(voltar)} />;
  }
  return null;
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
  if (base === "principal.php") return "/dashboard";
  if (base === "buscar-candidato-ponto.php") return "/ponto/colaboradores";
  if (base === "cadastrar-colaborador.php") return "/colaboradores/novo";
  if (base === "buscar-escala.php") return "/escalas";
  if (base === "cadastrar-escala.php") return "/escalas/nova";
  if (base === "buscar-carga-horaria.php") return "/cargas";
  if (base === "cadastrar-carga-horaria.php") return "/cargas/nova";
  if (base === "buscar-feriado.php") return "/feriados";
  if (base === "cadastrar-feriado.php") return "/feriados/novo";
  if (base === "relatorio-ponto-em-massa.php") return "/ponto/relatorio";
  if (base === "buscar-faturas.php") return "/faturas";
  if (base === "buscar-contratados.php") return "/contratados";
  if (base === "buscar-vagas.php") return "/vagas";
  if (base === "cadastrar-vaga-estagio.php") return "/vagas/nova?tipo=1";
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
  if (base === "cadastrar-vaga.php" && tipo === "4") return "/vagas";
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

function temLink(itens: ItemMenu[], arquivo: string): boolean {
  return itens.some((item) => (item.link?.split("?")[0] === arquivo) || temLink(item.children, arquivo));
}

/** Modalidades de vaga que o menu deste usuário libera: 1 = estágio, 2 = CLT. */
function tiposDeVaga(itens: ItemMenu[]): TipoVaga[] {
  const tipos = new Set<TipoVaga>();
  const visitar = (lista: ItemMenu[]) => {
    for (const item of lista) {
      if (item.link) {
        const destino = destinoDoLink(item.link);
        if (destino === "/vagas/nova?tipo=1") tipos.add("1");
        if (destino === "/vagas/nova?tipo=2") tipos.add("2");
      }
      visitar(item.children);
    }
  };
  visitar(itens);
  return [...tipos].sort();
}

const TITULOS: Array<[RegExp, string]> = [
  [/^\/dashboard$/, "Início"],
  [/^\/vagas\/nova$/, "Abrir vaga"],
  [/^\/vagas/, "Vagas"],
  [/^\/colaboradores\/novo$/, "Cadastrar colaborador"],
  [/^\/colaboradores/, "Colaboradores"],
  [/^\/contratados/, "Contratados"],
  [/^\/ponto\/relatorio$/, "Cartão ponto"],
  [/^\/ponto/, "Ponto por colaborador"],
  [/^\/escalas/, "Escalas"],
  [/^\/cargas/, "Cargas horárias"],
  [/^\/feriados/, "Feriados"],
  [/^\/faturas/, "Faturas"],
  [/^\/talentos/, "Banco de talentos"],
  [/^\/relatorios\/encaminhamentos/, "Candidatos encaminhados"],
  [/^\/relatorios\/documentos/, "Documentos"],
  [/^\/relatorios\/seguro/, "Seguro de vida"],
  [/^\/relatorios\/calendario/, "Calendário"],
  [/^\/avaliacoes/, "Avaliações"],
  [/^\/holerite/, "Holerites"],
  [/^\/empresa\/filial$/, "Cadastrar filial"],
  [/^\/empresa/, "Empresa"],
  [/^\/usuarios/, "Usuários"],
];

function tituloDaRota(pathname: string, opcao?: string) {
  if (pathname === "/opcao") return opcao ?? "Opção";
  return TITULOS.find(([regra]) => regra.test(pathname))?.[1] ?? "Portal da empresa";
}
