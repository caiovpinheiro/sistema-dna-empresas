import { Briefcase, Clock, FileText, Users, Wallet } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";

type Linha = Record<string, string | null>;
type Acesso = { href: string; label: string };

export function Inicio({ acessos = [] }: { acessos?: Acesso[] }) {
  const painel = useQuery({ queryKey: ["painel-empresa"], queryFn: () => api<{ empresa: string; cnpj: string; colaboradoresAtivos: number; vagasAbertas: number; contratos: number; batidasMes: number; pontoAtivo: boolean }>("/api/v1/empresa/painel") });
  if (painel.isLoading) {
    return <div className="grid gap-px overflow-hidden rounded-xl bg-[#eadff0] sm:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-20 animate-pulse bg-white" />)}</div>;
  }
  if (painel.isError || !painel.data) return <p className="text-sm text-rose-700">Não foi possível carregar o início desta empresa.</p>;
  const dados = painel.data.data;
  const cards: Array<[string, number]> = [
    ["Colaboradores ativos", dados.colaboradoresAtivos],
    ["Vagas abertas", dados.vagasAbertas],
    ["Contratos", dados.contratos],
  ];
  if (dados.pontoAtivo) cards.push(["Batidas no mês", dados.batidasMes]);
  return (
    <section className="grid gap-8">
      <div>
        <h2 className="max-w-[16ch] text-4xl font-medium tracking-tight text-[#1c1524]">{dados.empresa || "Início"}</h2>
        <p className="mt-2 text-sm text-[#6f6578]">{dados.cnpj}</p>
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(28_21_36_/_5%),0_16px_40px_rgb(106_75_132_/_7%)]">
        <div className={`grid ${cards.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
          {cards.map(([titulo, valor], index) => (
            <article key={String(titulo)} className={`px-6 py-5 ${index > 0 ? "border-t border-[#f0ebf3] sm:border-t-0 sm:border-l" : ""}`}>
              <p className="text-4xl font-medium tabular-nums tracking-tight text-[#1c1524]">{valor}</p>
              <p className="mt-2 text-sm text-[#6f6578]">{titulo}</p>
            </article>
          ))}
        </div>
        {acessos.length ? (
          <div className="border-t border-[#f0ebf3]">
            {acessos.map((acesso) => (
              <RouterLink key={acesso.href} to={acesso.href} className="flex items-center gap-3 border-t border-[#f0ebf3] px-5 py-3.5 text-sm font-medium text-[#1c1524] transition duration-150 first:border-t-0 hover:bg-[#faf8fb]">
                <AcessoIcon nome={acesso.label} />
                {acesso.label}
              </RouterLink>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AcessoIcon({ nome }: { nome: string }) {
  const comum = "shrink-0 text-[#6a4b84]";
  const caixa = "grid h-8 w-8 place-items-center rounded-lg bg-[#f6f1f8]";
  const icone = nome === "Colaboradores" ? <Users size={16} className={comum} />
    : nome === "Vagas" ? <Briefcase size={16} className={comum} />
    : nome === "Ponto" ? <Clock size={16} className={comum} />
    : nome === "Faturas" ? <Wallet size={16} className={comum} />
    : <FileText size={16} className={comum} />;
  return <span className={caixa}>{icone}</span>;
}

export function Consulta({ titulo, caminho, colunas, linkNome, linkColuna = "nome", filtroStatus = false }: { titulo: string; caminho: string; colunas: Array<{ chave: string; titulo: string }>; linkNome?: (linha: Linha) => string | null; linkColuna?: string; filtroStatus?: boolean }) {
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");
  const lista = useQuery({
    queryKey: [caminho, busca, filtroStatus ? status : ""],
    queryFn: () => api<Linha[]>(`${caminho}?q=${encodeURIComponent(busca)}${filtroStatus ? `&status=${status}` : ""}`),
  });
  const linhas = lista.data?.data ?? [];
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#24182d]">{titulo}</h2>
          {filtroStatus && !lista.isLoading && !lista.isError ? <p className="text-sm text-[#6f6578]">{linhas.length === 1 ? "1 registro" : `${linhas.length} registros`}</p> : null}
        </div>
        {filtroStatus ? (
          <div className="flex gap-2">
            {[["todos", "Todos"], ["ativo", "Ativo"], ["inativo", "Inativo"]].map(([valor, rotulo]) => (
              <button key={valor} type="button" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${status === valor ? "bg-[#6a4b84] text-white" : "bg-white text-[#6a4b84] ring-1 ring-[#eadff0]"}`} onClick={() => setStatus(valor)}>{rotulo}</button>
            ))}
          </div>
        ) : null}
      </div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setBusca(q.trim()); }}>
        <input className="h-10 flex-1 rounded-lg border border-[#eadff0] bg-white px-3 text-sm outline-none focus:border-[#6a4b84] focus:ring-4 focus:ring-[#6a4b84]/15" placeholder="Buscar por nome ou cargo" value={q} onChange={(event) => setQ(event.target.value)} />
        <button className="rounded-lg bg-[#6a4b84] px-4 text-sm font-semibold text-white hover:bg-[#593d70]">Buscar</button>
      </form>
      {lista.isLoading ? <p className="text-sm text-[#7a6b86]">Carregando…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-700">Não foi possível carregar esta lista.</p> : null}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-[#eadff0]">
        <table className="data-table min-w-[640px]">
          <thead>
            <tr>{colunas.map((coluna) => <th key={coluna.chave}>{coluna.titulo}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((linha, index) => (
              <tr key={index}>
                {colunas.map((coluna) => {
                  const texto = linha[coluna.chave] || "—";
                  const href = coluna.chave === linkColuna ? linkNome?.(linha) : null;
                  return <td key={coluna.chave}>{href ? <RouterLink className="font-medium text-[#5b21b6] hover:underline" to={href}>{texto}</RouterLink> : texto}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.isLoading && !lista.isError && linhas.length === 0 ? <p className="px-4 py-8 text-sm text-[#7a6b86]">{filtroStatus && status !== "todos" ? "Nenhum colaborador neste status." : "Nenhum registro desta empresa."}</p> : null}
      </div>
    </section>
  );
}

export function Faturas() {
  const [situacao, setSituacao] = useState("aberta");
  const lista = useQuery({
    queryKey: ["faturas-empresa", situacao],
    queryFn: () => api<Array<{ id: string; valor: string | null; vencimento: string | null; pagamento: string | null; link: string | null; situacao: string; competencia: string | null }>>(`/api/v1/empresa/faturas?situacao=${situacao}`),
  });
  const linhas = lista.data?.data ?? [];
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-[#24182d]">Faturas</h2>
        <div className="flex gap-2">
          {[["aberta", "Abertas"], ["paga", "Pagas"], ["todas", "Todas"]].map(([valor, rotulo]) => (
            <button key={valor} type="button" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${situacao === valor ? "bg-[#6a4b84] text-white" : "bg-white text-[#6a4b84] ring-1 ring-[#eadff0]"}`} onClick={() => setSituacao(valor)}>{rotulo}</button>
          ))}
        </div>
      </div>
      {lista.isLoading ? <p className="text-sm text-[#7a6b86]">Carregando faturas…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-700">Não foi possível carregar as faturas.</p> : null}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-[#eadff0]">
        <table className="data-table min-w-[720px]">
          <thead>
            <tr><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Pagamento</th><th></th></tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.id}>
                <td>{linha.id ? <RouterLink className="font-medium text-[#5b21b6] hover:underline" to={`/faturas/${linha.id}`}>{linha.competencia || "Fatura"}</RouterLink> : (linha.competencia || "—")}</td>
                <td>{linha.vencimento || "—"}</td>
                <td className="tabular-nums">{linha.valor ? `R$ ${linha.valor}` : "—"}</td>
                <td>{linha.situacao}</td>
                <td>{linha.pagamento || "—"}</td>
                <td>{linha.situacao === "Aberta" && linha.link ? <a className="font-semibold text-[#6a4b84]" href={linha.link} target="_blank" rel="noreferrer">Pagar</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.isLoading && !lista.isError && linhas.length === 0 ? <p className="px-4 py-8 text-sm text-[#7a6b86]">Nenhuma fatura nesta situação.</p> : null}
      </div>
    </section>
  );
}

export function Ficha({ caminho, voltar }: { caminho: string; voltar: string }) {
  const ficha = useQuery({ queryKey: [caminho], queryFn: () => api<{ titulo: string; subtitulo: string; campos: Array<{ rotulo: string; valor: string }> }>(caminho) });
  const navigate = useNavigate();
  const dados = ficha.data?.data;
  return (
    <section className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#24182d]">{dados?.titulo || "Registro"}</h2>
          {dados?.subtitulo ? <p className="text-sm text-[#6f6578]">{dados.subtitulo}</p> : null}
        </div>
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#6a4b84] ring-1 ring-[#eadff0]" onClick={() => navigate(voltar)}>Voltar</button>
      </div>
      {ficha.isLoading ? <p className="text-sm text-[#7a6b86]">Carregando…</p> : null}
      {ficha.isError ? <p className="text-sm text-rose-700">{ficha.error instanceof ApiError ? ficha.error.message : "Não foi possível abrir este registro."}</p> : null}
      {dados ? (
        <dl className="grid gap-px overflow-hidden rounded-xl bg-[#eadff0] sm:grid-cols-2">
          {dados.campos.map((campo) => (
            <div key={campo.rotulo} className="bg-white px-4 py-3">
              <dt className="text-xs text-[#6f6578]">{campo.rotulo}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-[#24182d]">{campo.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
