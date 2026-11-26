import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alerta, Badge, Button, CabecalhoPagina, Card, Skeleton, cn } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { filtrar } from "../lib/busca";
import type { PermissaoPonto } from "../lib/acesso";
import { CampoBusca } from "./consultas";

type Regra = { ativa: boolean; todos: boolean; ids: string[] };
type Colaborador = { id_candidato: string; nome: string; cargo: string | null; departamento: string | null; ativo: boolean };
type Configuracao = {
  colaborador: Colaborador;
  permissoes: Record<PermissaoPonto, Regra>;
  colaboradores: Colaborador[];
};
type LinhaLista = Colaborador & { permissoes: PermissaoPonto[] };

const PERMISSOES: Array<{ chave: PermissaoPonto; titulo: string; curto: string; texto: string }> = [
  { chave: "ver", titulo: "Ver o ponto", curto: "Ver", texto: "Espelho de ponto, relatório do período e saldo dos colaboradores escolhidos." },
  { chave: "solicitacoes", titulo: "Responder solicitações", curto: "Solicitações", texto: "Aprovar ou recusar os pedidos de ajuste e de inclusão de marcação. Os pedidos chegam para a empresa e para quem tiver esta permissão. Os pedidos dele mesmo continuam indo só para a empresa." },
  { chave: "cadastro", titulo: "Cadastro do colaborador", curto: "Cadastro", texto: "Cadastrar colaborador, trocar a jornada, redefinir a senha do ponto, desligar e reativar." },
  { chave: "empresa", titulo: "Férias, feriados e jornadas", curto: "Férias e jornadas", texto: "Lançar férias e recesso dos colaboradores escolhidos, e mexer nas jornadas e nos feriados. Jornadas e feriados valem para a empresa toda." },
];

/**
 * Lista dos colaboradores para a empresa escolher quem ajuda no ponto. Quem recebe permissão usa o próprio app do ponto
 * (CPF e senha dele): o acesso da empresa ao portal continua sendo um só.
 */
export function PermissoesPontoLista() {
  const lista = useQuery({ queryKey: ["permissoes-ponto"], queryFn: () => api<LinhaLista[]>("/api/v1/empresa/ponto/permissoes") });
  const [busca, setBusca] = useState("");
  const [soComPermissao, setSoComPermissao] = useState(false);
  const linhas = filtrar(lista.data?.data ?? [], busca, ["nome", "cargo", "departamento"]).filter((linha) => !soComPermissao || linha.permissoes.length);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo="Colaboradores: permissões do ponto" descricao="Clique no colaborador para dar permissões no ponto da equipe. Ele usa o próprio app do ponto, com o CPF e a senha dele, e não entra no portal da empresa." />
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[14rem] flex-1"><CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar por nome, cargo ou departamento…" /></div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" className="accent-violet-700" checked={soComPermissao} onChange={(event) => setSoComPermissao(event.target.checked)} /> Só quem tem permissão</label>
        </div>
        {lista.isLoading ? <Skeleton className="h-40" /> : null}
        {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar os colaboradores."}</Alerta> : null}
        {lista.data ? (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {linhas.map((linha) => (
              <li key={linha.id_candidato}>
                <Link to={`/usuarios/colaborador/${encodeURIComponent(linha.id_candidato)}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5 transition hover:bg-slate-50">
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-semibold text-violet-800">{linha.nome}</span>
                    <span className="truncate text-xs text-slate-500">{[linha.cargo, linha.departamento].filter(Boolean).join(" · ") || "Sem cargo"}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {linha.ativo ? null : <Badge value="Desligado">Desligado</Badge>}
                    {linha.permissoes.length
                      ? PERMISSOES.filter((item) => linha.permissoes.includes(item.chave)).map((item) => <span key={item.chave} className="rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">{item.curto}</span>)
                      : <span className="text-xs text-slate-400">Só o próprio ponto</span>}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
            {!linhas.length ? <li className="px-3 py-4 text-sm text-slate-500">Ninguém encontrado.</li> : null}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * O que um colaborador pode ver e fazer no ponto dos outros. Uma escolha de pessoas só, que vale para todas as permissões
 * marcadas. Quem não está liberado não aparece em nenhuma tela (LGPD: acesso só ao necessário).
 */
export function PermissoesColaborador({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const chave = ["permissoes-ponto", id];
  const config = useQuery({ queryKey: chave, queryFn: () => api<Configuracao>(`/api/v1/empresa/ponto/permissoes/${encodeURIComponent(id)}`) });
  const [marcadas, setMarcadas] = useState<Set<PermissaoPonto> | null>(null);
  const [todos, setTodos] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [diferentes, setDiferentes] = useState(false);
  const [salvo, setSalvo] = useState(false);
  useEffect(() => {
    if (!config.data) return;
    const regras = config.data.data.permissoes;
    const ativas = PERMISSOES.filter((item) => regras[item.chave].ativa);
    // Permissões salvas antes com pessoas diferentes: junta todo mundo numa lista só.
    const uniao = [...new Set(ativas.flatMap((item) => regras[item.chave].ids))];
    const comTodos = ativas.some((item) => regras[item.chave].todos);
    const assinaturas = new Set(ativas.map((item) => (regras[item.chave].todos ? "*" : [...regras[item.chave].ids].sort().join(","))));
    setMarcadas(new Set(ativas.map((item) => item.chave)));
    setTodos(comTodos);
    setIds(uniao);
    setDiferentes(assinaturas.size > 1);
  }, [config.data]);
  const montar = (): Record<PermissaoPonto, Regra> =>
    Object.fromEntries(PERMISSOES.map((item) => [item.chave, { ativa: Boolean(marcadas?.has(item.chave)), todos, ids }])) as Record<PermissaoPonto, Regra>;
  const salvar = useMutation({
    mutationFn: () => api<Configuracao>(`/api/v1/empresa/ponto/permissoes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ permissoes: montar() }) }),
    onSuccess: async (resposta) => {
      queryClient.setQueryData(chave, resposta);
      await queryClient.invalidateQueries({ queryKey: ["permissoes-ponto"], exact: true });
      setSalvo(true);
    },
  });
  const dados = config.data?.data;
  const mudou = () => setSalvo(false);
  const trocarPermissao = (permissao: PermissaoPonto) => {
    mudou();
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(permissao)) nova.delete(permissao);
      else nova.add(permissao);
      return nova;
    });
  };
  const algumaMarcada = Boolean(marcadas?.size);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link to="/usuarios" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Usuários</Link>
      <CabecalhoPagina titulo={dados ? `Permissões de ${dados.colaborador.nome}` : "Permissões"}
        descricao={dados ? [dados.colaborador.cargo, dados.colaborador.departamento].filter(Boolean).join(" · ") || "O que este colaborador pode fazer no ponto dos outros." : "O que este colaborador pode fazer no ponto dos outros."} />
      {config.isLoading ? <Skeleton className="h-60" /> : null}
      {config.isError ? <Alerta>{config.error instanceof ApiError ? config.error.message : "Não foi possível carregar as permissões."}</Alerta> : null}
      {dados && marcadas ? (
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setSalvo(false); salvar.mutate(); }}>
          <Alerta tom="aviso">Ele entra pelo app do ponto, com o CPF e a senha dele, e vê o botão "Gestão do ponto da equipe". Sem nenhuma permissão marcada, ele só vê o próprio ponto.</Alerta>
          <Card className="grid gap-3">
            <div>
              <p className="text-sm font-bold text-ink">1. O que ele pode fazer</p>
              <p className="text-xs text-slate-500">Marque uma ou mais. Todas valem para os mesmos colaboradores, escolhidos logo abaixo.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSOES.map((item) => {
                const ativa = marcadas.has(item.chave);
                return (
                  <label key={item.chave} className={cn("flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition", ativa ? "bg-violet-50 ring-violet-300" : "bg-white ring-slate-200 hover:bg-slate-50")}>
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-violet-700" checked={ativa} onChange={() => trocarPermissao(item.chave)} />
                    <span className="grid gap-0.5">
                      <span className="text-sm font-bold text-ink">{item.titulo}</span>
                      <span className="text-xs text-slate-500">{item.texto}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Card>
          {algumaMarcada ? (
            <Card className="grid gap-3">
              <div>
                <p className="text-sm font-bold text-ink">2. De quais colaboradores</p>
                <p className="text-xs text-slate-500">Vale para todas as permissões marcadas acima. Ele nunca responde nem mexe no próprio ponto.</p>
              </div>
              {diferentes ? <Alerta tom="aviso">As permissões dele tinham pessoas diferentes. Juntamos todos numa lista só: ao salvar, todas as permissões passam a valer para os colaboradores abaixo.</Alerta> : null}
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Para quem valem as permissões">
                {([[true, "Todos os colaboradores"], [false, "Escolher colaboradores"]] as const).map(([valor, rotulo]) => (
                  <button key={rotulo} type="button" role="radio" aria-checked={todos === valor} onClick={() => { mudou(); setTodos(valor); }}
                    className={cn("inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold ring-1 transition", todos === valor ? "bg-violet-700 text-white ring-violet-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                    {rotulo}
                  </button>
                ))}
              </div>
              {todos ? <p className="text-xs text-slate-500">Vale para todos, inclusive quem for cadastrado depois.</p> : (
                <EscolherColaboradores colaboradores={dados.colaboradores} escolhidos={ids} aoMudar={(novos) => { mudou(); setIds(novos); }} />
              )}
              {!todos && !ids.length ? <Alerta tom="aviso">Nenhum colaborador escolhido: as permissões ficam ligadas, mas sem ninguém para ele cuidar.</Alerta> : null}
            </Card>
          ) : null}
          {salvar.error ? <Alerta>{salvar.error instanceof ApiError ? salvar.error.message : "Não foi possível salvar."}</Alerta> : null}
          {salvo ? <Alerta tom="ok">Permissões salvas.</Alerta> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={salvar.isPending}><ShieldCheck size={16} /> {salvar.isPending ? "Salvando…" : "Salvar permissões"}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** Lista com busca por nome, cargo ou departamento; "marcar os da busca" facilita dar a permissão a um cargo inteiro. */
function EscolherColaboradores({ colaboradores, escolhidos, aoMudar }: { colaboradores: Colaborador[]; escolhidos: string[]; aoMudar: (ids: string[]) => void }) {
  const [busca, setBusca] = useState("");
  const [soEscolhidos, setSoEscolhidos] = useState(false);
  const marcados = useMemo(() => new Set(escolhidos), [escolhidos]);
  const linhas = filtrar(colaboradores, busca, ["nome", "cargo", "departamento"]).filter((linha) => !soEscolhidos || marcados.has(linha.id_candidato));
  const trocar = (id: string) => aoMudar(marcados.has(id) ? escolhidos.filter((item) => item !== id) : [...escolhidos, id]);
  const todosDaLista = linhas.length > 0 && linhas.every((linha) => marcados.has(linha.id_candidato));
  const marcarLista = () => {
    const ids = new Set(escolhidos);
    for (const linha of linhas) {
      if (todosDaLista) ids.delete(linha.id_candidato);
      else ids.add(linha.id_candidato);
    }
    aoMudar([...ids]);
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[14rem] flex-1"><CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar por nome, cargo ou departamento…" /></div>
        <Button type="button" variant="secondary" onClick={marcarLista} disabled={!linhas.length}>
          {todosDaLista ? "Desmarcar" : "Marcar"} {busca ? "os da busca" : "todos"} ({linhas.length})
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{escolhidos.length === 1 ? "1 colaborador escolhido" : `${escolhidos.length} colaboradores escolhidos`}</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-violet-700" checked={soEscolhidos} onChange={(event) => setSoEscolhidos(event.target.checked)} /> Mostrar só os escolhidos</label>
      </div>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
        {linhas.map((linha) => (
          <li key={linha.id_candidato}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={marcados.has(linha.id_candidato)} onChange={() => trocar(linha.id_candidato)} />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-semibold text-ink">{linha.nome}</span>
                <span className="truncate text-xs text-slate-500">{[linha.cargo, linha.departamento].filter(Boolean).join(" · ") || "Sem cargo"}</span>
              </span>
              {linha.ativo ? null : <Badge value="Desligado">Desligado</Badge>}
            </label>
          </li>
        ))}
        {!linhas.length ? <li className="px-3 py-4 text-sm text-slate-500">Ninguém encontrado.</li> : null}
      </ul>
    </div>
  );
}
