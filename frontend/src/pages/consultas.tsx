import { ArrowLeft, ArrowRight, Briefcase, CalendarDays, ChevronRight, Clock, ExternalLink, FileText, Plus, Search, ShieldCheck, UserCheck, Users, Wallet, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { dataBr, dinheiro, haQuantoTempo, primeiroNome } from "../lib/formato";
import { Alerta, Badge, CabecalhoPagina, Card, Empty, FiltroChips, Input, Resumo, Skeleton, botao, chave } from "../components/ui";

type Linha = Record<string, string | number | null>;
export type Acesso = { href: string; label: string };
export type VagaLinha = { id: string; codigo: string | null; cargo: string | null; contrato: string | null; vagas: number | string | null; salario: string | null; cidade: string | null; periodo: string | null; situacao: string; dataabertura: string | null; aceita_medio?: boolean | null };
type PainelDados = { empresa: string; cnpj: string; colaboradoresAtivos: number; vagasAbertas: number; contratos: number; batidasMes: number; pontoAtivo: boolean };

const ICONES: Record<string, LucideIcon> = {
  "/colaboradores": Users,
  "/vagas": Briefcase,
  "/contratados": UserCheck,
  "/ponto/relatorio": Clock,
  "/faturas": Wallet,
  "/relatorios/encaminhamentos": ArrowRight,
  "/relatorios/documentos": FileText,
  "/relatorios/seguro": ShieldCheck,
  "/relatorios/calendario": CalendarDays,
};

export function Inicio({ acessos = [], nome, abrirVaga }: { acessos?: Acesso[]; nome: string; abrirVaga: string | null }) {
  const painel = useQuery({ queryKey: ["painel-empresa"], queryFn: () => api<PainelDados>("/api/v1/empresa/painel") });
  const liberado = (href: string) => acessos.some((acesso) => acesso.href === href);
  const vagas = useQuery({
    queryKey: ["/api/v1/empresa/vagas", ""],
    queryFn: () => api<VagaLinha[]>("/api/v1/empresa/vagas?q="),
    enabled: liberado("/vagas"),
  });
  const saudacao = (() => {
    const hora = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  })();
  const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }).format(new Date());

  if (painel.isLoading) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <Skeleton className="h-24" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (painel.isError || !painel.data) return <Alerta>Não foi possível carregar o início desta empresa. Atualize a página em instantes.</Alerta>;
  const dados = painel.data.data;
  const indicadores: Array<{ titulo: string; valor: number; href: string; icone: LucideIcon; texto: string }> = [
    { titulo: "Colaboradores ativos", valor: dados.colaboradoresAtivos, href: "/colaboradores", icone: Users, texto: "Pessoas trabalhando hoje" },
    { titulo: "Vagas em aberto", valor: dados.vagasAbertas, href: "/vagas", icone: Briefcase, texto: "Em seleção com a DNA Work" },
    { titulo: "Contratações", valor: dados.contratos, href: "/contratados", icone: UserCheck, texto: "Desde o início da parceria" },
  ];
  if (dados.pontoAtivo) indicadores.push({ titulo: "Batidas no mês", valor: dados.batidasMes, href: "/ponto/relatorio", icone: Clock, texto: "Registros de ponto" });
  const abertas = (vagas.data?.data ?? []).filter((vaga) => chave(vaga.situacao) === "aberta").slice(0, 5);
  const atalhos = acessos.filter((acesso) => !indicadores.some((item) => item.href === acesso.href));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#2e1065_0%,#5b21b6_55%,#7c3aed_100%)] px-5 py-6 text-white shadow-[0_18px_40px_rgb(76_29_149/0.22)] md:px-7 md:py-7">
        <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-fuchsia-400/25 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <p className="text-sm first-letter:uppercase text-violet-100">{hoje}</p>
            <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{saudacao}{primeiroNome(nome) ? `, ${primeiroNome(nome)}` : ""}!</h1>
            <p className="truncate text-sm text-violet-100">{[dados.empresa, dados.cnpj].filter(Boolean).join(" · ")}</p>
          </div>
          {abrirVaga ? (
            <Link to={abrirVaga} className="botao inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-violet-800 shadow-sm hover:bg-violet-50">
              <Plus size={16} /> Abrir vaga
            </Link>
          ) : null}
        </div>
      </section>

      <section className={`grid gap-3 sm:grid-cols-2 ${indicadores.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`} aria-label="Números da empresa">
        {indicadores.map((item) => {
          const conteudo = (
            <>
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><item.icone size={19} /></span>
                {liberado(item.href) ? <ChevronRight size={18} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600" /> : null}
              </div>
              <p className="mt-4 text-3xl font-extrabold tabular-nums tracking-tight text-ink">{item.valor.toLocaleString("pt-BR")}</p>
              <p className="text-sm font-semibold text-slate-700">{item.titulo}</p>
              <p className="text-xs text-slate-500">{item.texto}</p>
            </>
          );
          const classe = "group rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(28_21_36/0.05)]";
          return liberado(item.href)
            ? <Link key={item.href} to={item.href} className={`${classe} transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-[0_10px_24px_rgb(76_29_149/0.08)]`}>{conteudo}</Link>
            : <article key={item.href} className={classe}>{conteudo}</article>;
        })}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {liberado("/vagas") ? (
          <Card className="p-0">
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div>
                <h2 className="text-base font-bold text-ink">Vagas em aberto</h2>
                <p className="text-sm text-slate-500">As mais recentes. Clique para ver os detalhes.</p>
              </div>
              <Link to="/vagas" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50">Ver todas <ChevronRight size={15} /></Link>
            </header>
            {vagas.isLoading ? <div className="grid gap-2 p-4">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div> : null}
            {vagas.isError ? <div className="p-4"><Alerta>Não foi possível carregar as vagas.</Alerta></div> : null}
            {!vagas.isLoading && !vagas.isError && abertas.length === 0 ? (
              <div className="grid justify-items-center gap-1 px-6 py-10 text-center">
                <p className="font-semibold text-ink">Nenhuma vaga em aberto</p>
                <p className="text-sm text-slate-500">Quando precisar contratar, abra uma vaga e a DNA Work começa a seleção.</p>
                {abrirVaga ? <Link to={abrirVaga} className={botao("primary", "botao mt-3")}><Plus size={16} /> Abrir vaga</Link> : null}
              </div>
            ) : null}
            <ul className="divide-y divide-slate-100">
              {abertas.map((vaga) => (
                <li key={vaga.id}>
                  <Link to={`/vagas/${vaga.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><Briefcase size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{vaga.cargo || "Vaga"}</span>
                      <span className="block truncate text-xs text-slate-500">{[vaga.cidade, vaga.vagas ? `${vaga.vagas} ${Number(vaga.vagas) === 1 ? "posição" : "posições"}` : null, haQuantoTempo(vaga.dataabertura) ? `aberta ${haQuantoTempo(vaga.dataabertura)}` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    {vaga.contrato ? <Badge value={vaga.contrato}>{vaga.contrato}</Badge> : null}
                    <ChevronRight size={16} className="shrink-0 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : <div className="hidden lg:block" />}

        {atalhos.length ? (
          <Card className="p-0">
            <h2 className="border-b border-slate-100 px-4 py-3.5 text-base font-bold text-ink">Acesso rápido</h2>
            <ul className="grid p-2">
              {atalhos.map((acesso) => {
                const Icone = ICONES[acesso.href] ?? FileText;
                return (
                  <li key={acesso.href}>
                    <Link to={acesso.href} className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-ink">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-600"><Icone size={16} /></span>
                      <span className="flex-1">{acesso.label}</span>
                      <ChevronRight size={15} className="text-slate-300" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** Campo de busca com lupa, igual em todas as listas. */
export function CampoBusca({ valor, onChange, placeholder }: { valor: string; onChange: (valor: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input className="pl-9" type="search" aria-label={placeholder} placeholder={placeholder} value={valor} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/** Valor de célula: situação e modalidade viram selo; datas ficam no formato brasileiro. */
export function Celula({ chave: coluna, valor }: { chave: string; valor: string | number | null | undefined }) {
  const texto = valor === null || valor === undefined || String(valor).trim() === "" ? "—" : String(valor);
  if (texto === "—") return <span className="text-slate-400">—</span>;
  if (["situacao", "modalidade", "contrato"].includes(coluna)) return <Badge value={texto}>{texto}</Badge>;
  if (/^data|inicio$|^fim$|abertura|datainicio|datacadastro|data_entrevista/.test(coluna)) return <span className="whitespace-nowrap tabular-nums">{dataBr(texto)}</span>;
  return <>{texto}</>;
}

export function Consulta({ titulo, descricao, caminho, colunas, linkNome, linkColuna = "nome", filtroStatus = false, singular = "registro", plural = "registros", acoes }: {
  titulo: string;
  descricao?: string;
  caminho: string;
  colunas: Array<{ chave: string; titulo: string }>;
  linkNome?: (linha: Linha) => string | null;
  linkColuna?: string;
  filtroStatus?: boolean;
  singular?: string;
  plural?: string;
  acoes?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<"todos" | "ativo" | "inativo">(filtroStatus ? "ativo" : "todos");
  const lista = useQuery({
    queryKey: [caminho, busca, filtroStatus ? status : ""],
    queryFn: () => api<Linha[]>(`${caminho}?q=${encodeURIComponent(busca)}${filtroStatus ? `&status=${status}` : ""}`),
  });
  const linhas = lista.data?.data ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo={titulo} descricao={descricao} acoes={acoes} />
      <Card className="flex flex-wrap items-center gap-3">
        <form className="flex min-w-[16rem] flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); setBusca(q.trim()); }}>
          <CampoBusca valor={q} onChange={(valor) => { setQ(valor); if (!valor) setBusca(""); }} placeholder="Buscar por nome ou cargo" />
          <button className={botao("secondary")}>Buscar</button>
        </form>
        {filtroStatus ? (
          <FiltroChips rotulo="Situação" valor={status} onChange={setStatus} opcoes={[{ id: "ativo", rotulo: "Ativos" }, { id: "inativo", rotulo: "Inativos" }, { id: "todos", rotulo: "Todos" }]} />
        ) : null}
      </Card>
      <Resumo total={linhas.length} singular={singular} plural={plural} carregando={lista.isLoading} />
      {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar esta lista."}</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-64" /> : null}
      {!lista.isLoading && !lista.isError && linhas.length === 0 ? (
        <Empty titulo={busca ? "Nada encontrado" : "Nenhum registro ainda"} texto={busca ? "Confira a grafia ou limpe a busca para ver tudo." : filtroStatus && status !== "todos" ? "Não há ninguém nesta situação. Veja a aba Todos." : "Assim que houver registros desta empresa, eles aparecem aqui."} />
      ) : null}
      {!lista.isLoading && linhas.length ? <TabelaLinhas linhas={linhas} colunas={colunas} linkNome={linkNome} linkColuna={linkColuna} /> : null}
    </div>
  );
}

/** Tabela no computador e cartões no celular, com as mesmas informações. */
export function TabelaLinhas({ linhas, colunas, linkNome, linkColuna = "nome" }: {
  linhas: Array<Record<string, string | number | null>>;
  colunas: Array<{ chave: string; titulo: string }>;
  linkNome?: (linha: Record<string, string | number | null>) => string | null;
  linkColuna?: string;
}) {
  const [principal, ...resto] = [colunas.find((coluna) => coluna.chave === linkColuna) ?? colunas[0], ...colunas.filter((coluna) => coluna.chave !== linkColuna)];
  return (
    <Card className="p-0">
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead><tr>{colunas.map((coluna) => <th key={coluna.chave}>{coluna.titulo}</th>)}<th><span className="sr-only">Abrir</span></th></tr></thead>
          <tbody>
            {linhas.map((linha, index) => {
              const href = linkNome?.(linha) ?? null;
              return (
                <tr key={String(linha.id ?? linha.id_candidato ?? index)}>
                  {colunas.map((coluna) => (
                    <td key={coluna.chave} className={coluna.chave === linkColuna ? "max-w-72" : ""}>
                      {coluna.chave === linkColuna && href ? <Link className="block truncate" to={href}>{String(linha[coluna.chave] ?? "Abrir")}</Link> : <Celula chave={coluna.chave} valor={linha[coluna.chave]} />}
                    </td>
                  ))}
                  <td className="w-px whitespace-nowrap text-right">
                    {href ? <Link to={href} aria-label="Abrir" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-slate-100 md:hidden">
        {linhas.map((linha, index) => {
          const href = linkNome?.(linha) ?? null;
          const titulo = String(linha[principal.chave] ?? "—");
          return (
            <li key={String(linha.id ?? linha.id_candidato ?? index)} className="grid gap-2 px-4 py-3">
              {href ? <Link to={href} className="flex items-center justify-between gap-2 font-semibold text-violet-800">{titulo}<ChevronRight size={16} className="shrink-0 text-slate-300" /></Link> : <p className="font-semibold text-ink">{titulo}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {resto.map((coluna) => (
                  <div key={coluna.chave} className="min-w-0">
                    <dt className="text-xs text-slate-500">{coluna.titulo}</dt>
                    <dd className="truncate text-slate-800"><Celula chave={coluna.chave} valor={linha[coluna.chave]} /></dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function Faturas() {
  const [situacao, setSituacao] = useState<"aberta" | "paga" | "todas">("aberta");
  const lista = useQuery({
    queryKey: ["faturas-empresa", situacao],
    queryFn: () => api<Array<{ id: string; valor: string | null; vencimento: string | null; pagamento: string | null; link: string | null; situacao: string; competencia: string | null }>>(`/api/v1/empresa/faturas?situacao=${situacao}`),
  });
  const linhas = lista.data?.data ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo="Faturas" descricao="Boletos da DNA Work para esta empresa. Nas abertas, use Pagar para abrir o boleto ou o Pix." />
      <FiltroChips rotulo="Situação da fatura" valor={situacao} onChange={setSituacao} opcoes={[{ id: "aberta", rotulo: "Abertas" }, { id: "paga", rotulo: "Pagas" }, { id: "todas", rotulo: "Todas" }]} />
      {lista.isError ? <Alerta>Não foi possível carregar as faturas.</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-48" /> : null}
      {!lista.isLoading && !lista.isError && linhas.length === 0 ? <Empty titulo={situacao === "aberta" ? "Nenhuma fatura em aberto" : "Nenhuma fatura nesta situação"} texto={situacao === "aberta" ? "Tudo em dia por aqui." : "Troque a situação para ver as outras faturas."} /> : null}
      {linhas.length ? (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {linhas.map((linha) => (
              <li key={linha.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><Wallet size={18} /></span>
                <div className="min-w-0 flex-1">
                  <Link to={`/faturas/${linha.id}`} className="block truncate font-semibold text-ink hover:text-violet-700">{linha.competencia || "Fatura"}</Link>
                  <p className="text-xs text-slate-500">Vencimento {dataBr(linha.vencimento)}{linha.pagamento ? ` · Pago em ${dataBr(linha.pagamento)}` : ""}</p>
                </div>
                <p className="text-base font-bold tabular-nums text-ink">{linha.valor ? dinheiro(linha.valor) : "—"}</p>
                <Badge value={linha.situacao}>{linha.situacao}</Badge>
                {linha.situacao === "Aberta" && linha.link ? (
                  <a className={botao("primary", "botao h-9")} href={linha.link} target="_blank" rel="noreferrer">Pagar <ExternalLink size={14} /></a>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export function Ficha({ caminho, voltar, rotuloVoltar = "Voltar" }: { caminho: string; voltar: string; rotuloVoltar?: string }) {
  const ficha = useQuery({ queryKey: [caminho], queryFn: () => api<{ titulo: string; subtitulo: string; campos: Array<{ rotulo: string; valor: string }> }>(caminho) });
  const navigate = useNavigate();
  const bruto = ficha.data?.data;
  const dados = bruto ? { ...bruto, campos: bruto.campos.map((campo) => ({ ...campo, valor: formatarValor(campo.valor) })) } : undefined;
  const situacao = dados?.campos.find((campo) => campo.rotulo === "Situação")?.valor;
  const longos = (campo: { valor: string }) => campo.valor.length > 80 || campo.valor.includes("\n");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <button type="button" onClick={() => navigate(voltar)} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink">
        <ArrowLeft size={16} /> {rotuloVoltar}
      </button>
      {ficha.isLoading ? <Skeleton className="h-72" /> : null}
      {ficha.isError ? <Alerta>{ficha.error instanceof ApiError ? ficha.error.message : "Não foi possível abrir este registro."}</Alerta> : null}
      {dados ? (
        <>
          <CabecalhoPagina titulo={dados.titulo || "Registro"}>
            <div className="flex flex-wrap items-center gap-2">
              {dados.subtitulo ? <Badge value={dados.subtitulo}>{dados.subtitulo}</Badge> : null}
              {situacao && situacao !== "—" ? <Badge value={situacao}>{situacao}</Badge> : null}
            </div>
          </CabecalhoPagina>
          <Card className="p-0">
            <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
              {dados.campos.filter((campo) => campo.valor !== "—" && !longos(campo)).map((campo) => (
                <div key={campo.rotulo} className="border-b border-slate-100 px-4 py-3">
                  <dt className="text-xs font-medium text-slate-500">{campo.rotulo}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-ink">{campo.valor}</dd>
                </div>
              ))}
            </dl>
            {dados.campos.filter((campo) => campo.valor !== "—" && longos(campo)).map((campo) => (
              <div key={campo.rotulo} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                <dt className="text-xs font-medium text-slate-500">{campo.rotulo}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{campo.valor}</dd>
              </div>
            ))}
            {dados.campos.some((campo) => campo.valor === "—") ? (
              <p className="px-4 py-3 text-xs text-slate-400">Sem informação: {dados.campos.filter((campo) => campo.valor === "—").map((campo) => campo.rotulo).join(", ")}.</p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Datas do sistema antigo (2026/11/02) e valores ("R$ 1200,00") no formato brasileiro. */
function formatarValor(valor: string) {
  if (/^\d{4}[/-]\d{2}[/-]\d{2}( |T|$)/.test(valor)) return dataBr(valor);
  if (/^R\$\s*[\d.,]+$/.test(valor)) return dinheiro(valor);
  return valor;
}
