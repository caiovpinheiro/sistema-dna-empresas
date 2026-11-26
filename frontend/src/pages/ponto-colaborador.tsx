import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, KeyRound, MessageSquarePlus, Plus, UsersRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alerta, Badge, Button, Card, Field, Input, Textarea } from "../components/ui";
import { ApiError, api } from "../lib/api";

type Registro = { id: number; data: string; entrada: string | null; saida: string | null; nsrEntrada: number | null; nsrSaida: number | null };
type Painel = { nome: string; empresa: string; acao: "entrada" | "saida" | "bloqueado"; motivo: string | null; trocarSenha: boolean; saidasPendentes: Array<{ id: number; data: string; entrada: string }>; registros: Registro[] };
type Comprovante = { id: number; tipo: "entrada" | "saida"; data: string; hora: string; nsr: number };

export function PontoLoginPage() {
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: () => api<{ nome: string }>("/api/v1/ponto/login", { method: "POST", body: JSON.stringify({ cpf, password }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessao-ponto"] });
      navigate("/ponto");
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Falha no login."),
  });
  return (
    <div className="login-fundo">
      <span className="login-orb login-orb-a" aria-hidden="true" />
      <span className="login-orb login-orb-b" aria-hidden="true" />
      <span className="login-orb login-orb-c" aria-hidden="true" />
      <div className="login-fundo-conteudo">
        <form className="relative w-full max-w-md rounded-[2rem] bg-white px-5 pb-8 pt-16 shadow-[0_24px_50px_rgb(49_10_80_/_18%)] sm:px-8" onSubmit={(event) => { event.preventDefault(); setErro(""); login.mutate(); }}>
          <span className="absolute left-1/2 top-0 z-10 flex h-24 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-white px-3 shadow-[0_14px_28px_rgb(49_10_80_/_18%)]">
            <img src="/logo-mono.png" alt="DNA Work" className="h-12 w-full object-contain" />
          </span>
          <h1 className="text-center text-xl font-extrabold">Bater ponto</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Use seu CPF e a senha. No primeiro acesso, use a senha que a empresa passou.</p>
          <input className="mt-6 h-12 w-full rounded-full bg-[#eceff3] px-4 text-sm outline-none focus:ring-4 focus:ring-[#7c3aed]/20" inputMode="numeric" autoComplete="username" required placeholder="000.000.000-00" aria-label="CPF" maxLength={14} value={cpf} onChange={(event) => setCpf(mascaraCpf(event.target.value))} />
          <input className="mt-4 h-12 w-full rounded-full bg-[#eceff3] px-4 text-sm outline-none focus:ring-4 focus:ring-[#7c3aed]/20" type="password" autoComplete="current-password" required placeholder="Senha" aria-label="Senha" value={password} onChange={(event) => setPassword(event.target.value)} />
          {erro ? <p className="mt-3 text-sm text-rose-600" role="alert">{erro}</p> : null}
          <button className="mt-6 h-12 w-full rounded-full bg-[#7c3aed] text-sm font-bold tracking-wide text-white transition duration-200 hover:bg-[#6d28d9] active:scale-[0.98] disabled:opacity-60" disabled={login.isPending}>
            {login.isPending ? "ENTRANDO…" : "ENTRAR"}
          </button>
          <Link to="/login" className="mt-4 block text-center text-sm font-semibold text-[#5b21b6]">Acesso da empresa</Link>
        </form>
      </div>
    </div>
  );
}

export function PontoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [parametros, setParametros] = useSearchParams();
  const tela = parametros.get("tela");
  const irPara = (destino: "solicitacoes" | "senha" | null, batida?: number) =>
    setParametros(destino ? { tela: destino, ...(batida ? { batida: String(batida) } : {}) } : {});
  const [erro, setErro] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [local, setLocal] = useState<{ latitude: number; longitude: number } | null>(null);
  const [avisoLocal, setAvisoLocal] = useState("");
  const [comprovante, setComprovante] = useState<Comprovante | null>(null);
  const [agora, setAgora] = useState(horaSp);
  const painel = useQuery({ queryKey: ["sessao-ponto"], queryFn: () => api<Painel>("/api/v1/ponto/painel"), retry: false });
  // Colaborador a quem a empresa deu permissões no ponto de outros: ganha o botão da gestão do ponto.
  const gestao = useQuery({
    queryKey: ["gestao-ponto-sessao"],
    queryFn: () => api<{ abas: Array<{ id: string }> }>("/api/v1/ponto/gestao/sessao"),
    enabled: painel.isSuccess,
    retry: false,
  });
  const sair = useMutation({
    mutationFn: () => api("/api/v1/ponto/logout", { method: "POST" }),
    onSettled: async () => {
      queryClient.removeQueries({ queryKey: ["sessao-ponto"] });
      navigate("/ponto/login");
    },
  });
  const bater = useMutation({
    mutationFn: (aceite: boolean) => api<Comprovante>("/api/v1/ponto/bater", {
      method: "POST",
      body: JSON.stringify({ confirmar: aceite, latitude: local?.latitude, longitude: local?.longitude }),
    }),
    onSuccess: async (resposta) => {
      setErro("");
      setConfirmar(false);
      setComprovante(resposta.data);
      await queryClient.invalidateQueries({ queryKey: ["sessao-ponto"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CONFIRMAR_PONTO") {
        setConfirmar(true);
        setErro("");
        return;
      }
      setErro(error instanceof ApiError ? error.message : "Não foi possível registrar o ponto.");
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(horaSp()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!navigator.geolocation) {
      setAvisoLocal("Este aparelho não informou a localização.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (posicao) => setLocal({ latitude: posicao.coords.latitude, longitude: posicao.coords.longitude }),
      () => setAvisoLocal("Autorize a localização para a batida ficar completa."),
    );
  }, []);

  if (painel.isLoading) return <div className="grid min-h-dvh place-items-center bg-[#f6f3f8] px-4 text-sm text-slate-500">Carregando relógio…</div>;
  if (painel.isError || !painel.data) return <PontoLoginPage />;
  const dados = painel.data.data;
  const titulo = dados.acao === "saida" ? "Saída" : "Entrada";
  const cabecalho = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[#5b21b6]">DNA Work</p>
        <h1 className="text-2xl font-extrabold">{dados.nome}</h1>
        <p className="text-sm text-slate-500">{dados.empresa}</p>
      </div>
      <Button type="button" variant="secondary" onClick={() => sair.mutate()}>Sair</Button>
    </div>
  );
  const moldura = (conteudo: ReactNode) => (
    <div className="min-h-dvh bg-[#f6f3f8] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto grid w-full max-w-lg gap-4">{cabecalho}{conteudo}</div>
    </div>
  );
  // Senha provisória (gerada pelo interno ou redefinida): troca antes de bater ponto.
  if (dados.trocarSenha) return moldura(<SenhaColaborador obrigatoria aoSalvar={() => queryClient.invalidateQueries({ queryKey: ["sessao-ponto"] })} />);
  if (tela === "senha") return moldura(<SenhaColaborador aoVoltar={() => irPara(null)} />);
  if (tela === "solicitacoes") return moldura(<SolicitacoesColaborador aoVoltar={() => irPara(null)} batidaInicial={parametros.get("batida")} />);

  return moldura(
    <>
        {dados.saidasPendentes.length ? (
          <div className="grid gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <p className="font-semibold">Ficou faltando a saída:</p>
            <ul className="grid gap-1">
              {dados.saidasPendentes.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{item.data}, entrada às {item.entrada}</span>
                  <button type="button" className="font-semibold text-[#5b21b6] underline" onClick={() => irPara("solicitacoes", item.id)}>Pedir ajuste</button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-800">Sem a saída, esse dia não conta horas. O próximo toque abre uma batida nova.</p>
          </div>
        ) : null}
        <Card className="grid justify-items-center gap-4 text-center hover:translate-y-0">
          <p className="text-5xl font-extrabold tabular-nums">{agora}</p>
          {dados.acao === "bloqueado" ? <p className="text-sm font-semibold text-rose-700">{dados.motivo}</p> : (
            <form className="grid w-full max-w-xs gap-3" onSubmit={(event) => { event.preventDefault(); setErro(""); bater.mutate(confirmar); }}>
              <p className="text-sm font-semibold">{titulo}</p>
              {avisoLocal ? <p className="text-xs text-amber-700">{avisoLocal}</p> : null}
              {confirmar ? <p className="text-sm text-amber-800">A última batida foi há menos de 5 minutos. Envie de novo para confirmar.</p> : null}
              {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
              <Button type="submit" className="h-12 rounded-full" disabled={bater.isPending}>{bater.isPending ? "Registrando…" : confirmar ? "Confirmar batida" : `Registrar ${titulo.toLowerCase()}`}</Button>
            </form>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" className="h-12" onClick={() => irPara("solicitacoes")}><MessageSquarePlus size={16} /> Solicitações</Button>
          <Button type="button" variant="secondary" className="h-12" onClick={() => irPara("senha")}><KeyRound size={16} /> Alterar senha</Button>
          {gestao.data?.data.abas.length ? (
            // Página inteira nova: a gestão usa as telas do portal com outro endereço de API (ver usarGestaoDoPonto).
            <a href="/ponto/gestao" className="col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#5b21b6] px-4 text-sm font-bold text-white hover:bg-[#4c1d95]"><UsersRound size={16} /> Gestão do ponto da equipe</a>
          ) : null}
        </div>
        {comprovante ? (
          <Card className="hover:translate-y-0">
            <h2 className="font-extrabold">Comprovante</h2>
            <p className="mt-2 text-sm text-slate-600">{comprovante.tipo === "entrada" ? "Entrada" : "Saída"} em {comprovante.data} às {comprovante.hora}</p>
            <p className="text-sm text-slate-600">NSR {comprovante.nsr}</p>
          </Card>
        ) : null}
        <Card className="hover:translate-y-0">
          <h2 className="font-extrabold">Últimos registros</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400"><tr><th className="py-2">Data</th><th>Entrada</th><th>Saída</th><th>NSR</th></tr></thead>
              <tbody>
                {dados.registros.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-2">{item.data}</td>
                    <td>{item.entrada || "—"}</td>
                    <td>{item.saida || "Pendente"}</td>
                    <td>{[item.nsrEntrada, item.nsrSaida].filter(Boolean).join(" / ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dados.registros.length === 0 ? <p className="py-3 text-sm text-slate-500">Nenhuma batida ainda.</p> : null}
          </div>
        </Card>
    </>,
  );
}

function Voltar({ aoVoltar }: { aoVoltar: () => void }) {
  return (
    <button type="button" onClick={aoVoltar} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-[#5b21b6] hover:underline">
      <ArrowLeft size={16} /> Voltar ao ponto
    </button>
  );
}

/** Troca da senha do colaborador (a mesma do portal do candidato). Obrigatória quando a senha é provisória. */
function SenhaColaborador({ obrigatoria = false, aoSalvar, aoVoltar }: { obrigatoria?: boolean; aoSalvar?: () => void; aoVoltar?: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [salva, setSalva] = useState(false);
  const salvar = useMutation({
    mutationFn: () => api("/api/v1/ponto/senha", { method: "POST", body: JSON.stringify({ senhaAtual: atual, senhaNova: nova }) }),
    onSuccess: () => {
      setAtual(""); setNova(""); setConfirma(""); setSalva(true);
      aoSalvar?.();
    },
    onError: (error) => {
      const doServidor = error instanceof ApiError ? error.campos ?? {} : {};
      setCampos(doServidor);
      setErro(Object.keys(doServidor).length ? "" : error instanceof ApiError ? error.message : "Não foi possível trocar a senha.");
    },
  });
  const enviar = () => {
    setSalva(false);
    setErro("");
    const locais: Record<string, string> = {};
    if (nova.length < 6) locais.senhaNova = "Use pelo menos 6 caracteres.";
    else if (nova !== confirma) locais.confirma = "As senhas não conferem.";
    setCampos(locais);
    if (!Object.keys(locais).length) salvar.mutate();
  };
  return (
    <>
      {aoVoltar ? <Voltar aoVoltar={aoVoltar} /> : null}
      <Card className="hover:translate-y-0">
        <h2 className="text-lg font-extrabold">{obrigatoria ? "Crie uma senha nova" : "Alterar senha"}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {obrigatoria
            ? "É seu primeiro acesso (ou a empresa criou uma senha nova para você). Crie a sua senha antes de bater o ponto."
            : "Depois de salvar, use a nova senha no próximo login."}
        </p>
        <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); enviar(); }}>
          <Field label={obrigatoria ? "Senha provisória" : "Senha atual"} erro={campos.senhaAtual}>
            <Input type="password" autoComplete="current-password" required value={atual} onChange={(event) => setAtual(event.target.value)} />
          </Field>
          <Field label="Nova senha" dica="pelo menos 6 caracteres" erro={campos.senhaNova}>
            <Input type="password" autoComplete="new-password" minLength={6} required value={nova} onChange={(event) => setNova(event.target.value)} />
          </Field>
          <Field label="Repita a nova senha" erro={campos.confirma}>
            <Input type="password" autoComplete="new-password" minLength={6} required value={confirma} onChange={(event) => setConfirma(event.target.value)} />
          </Field>
          {erro ? <Alerta>{erro}</Alerta> : null}
          {salva ? <Alerta tom="ok">Senha alterada. Use a nova no próximo login.</Alerta> : null}
          <Button type="submit" className="h-12" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar senha"}</Button>
        </form>
      </Card>
    </>
  );
}

type BatidaAjustavel = { id: number; data: string; dataIso: string; entrada: string | null; saida: string | null; pendenteEntrada: boolean; pendenteSaida: boolean };
type PedidoPonto = { chave: string; origem: "ajuste" | "inclusao"; dataIso: string; data: string; titulo: string; detalhe: string; motivo: string; situacao: "Pendente" | "Aprovada" | "Recusada"; resposta: string | null };
type ListaSolicitacoes = { pedidos: PedidoPonto[]; batidas: BatidaAjustavel[]; hoje: string; desde: string };

const somarDias = (iso: string, dias: number) => {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};
const erroGeral = (error: unknown, padrao: string) => (error instanceof ApiError ? error.message : padrao);
const hhmm = (valor: string | null | undefined) => (valor ?? "").slice(0, 5);
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const diaDaSemana = (iso: string) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Quantos dias o espelho mostra de cada vez. */
const POR_PAGINA = 14;

/** Um dia do espelho: as batidas em ordem e o que está pendente. */
type DiaEspelho = { iso: string; batidas: BatidaAjustavel[]; semSaida: boolean; pedidosPendentes: number };

/**
 * Pedidos do colaborador, no formato de espelho de ponto (como os apps de ponto fazem): uma linha por dia com as
 * batidas lado a lado. Toca no dia, corrige o horário errado ou inclui o período que não bateu, e envia tudo de uma vez.
 * Nada muda no ponto até a empresa aprovar (a lei não deixa o sistema criar ou mudar marcação sozinho).
 */
function SolicitacoesColaborador({ aoVoltar, batidaInicial }: { aoVoltar: () => void; batidaInicial?: string | null }) {
  const lista = useQuery({ queryKey: ["ponto-solicitacoes"], queryFn: () => api<ListaSolicitacoes>("/api/v1/ponto/solicitacoes") });
  const [aberto, setAberto] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const dados = lista.data?.data;
  const pedidos = dados?.pedidos ?? [];
  const dias: DiaEspelho[] = [];
  if (dados) {
    for (let iso = dados.hoje; iso >= dados.desde; iso = somarDias(iso, -1)) {
      // A lista do servidor vem do mais novo para o mais velho; no dia, a primeira batida é a de horário mais cedo.
      const batidas = dados.batidas.filter((batida) => batida.dataIso === iso).reverse();
      dias.push({
        iso,
        batidas,
        semSaida: iso < dados.hoje && batidas.some((batida) => batida.entrada && !batida.saida && !batida.pendenteSaida),
        pedidosPendentes: pedidos.filter((pedido) => pedido.dataIso === iso && pedido.situacao === "Pendente").length,
      });
    }
  }
  // O aviso "ficou faltando a saída" abre direto o dia daquela batida.
  useEffect(() => {
    if (!dados || !batidaInicial || aberto) return;
    const dia = dados.batidas.find((batida) => String(batida.id) === batidaInicial)?.dataIso;
    if (dia) setAberto(dia);
  }, [dados, batidaInicial, aberto]);
  const atencao = dias.filter((dia) => dia.semSaida);
  const linhaDoDia = (dia: DiaEspelho) => (
    <LinhaDia key={dia.iso} dia={dia} aberto={aberto === dia.iso} aoAbrir={() => setAberto(aberto === dia.iso ? null : dia.iso)} aoEnviar={() => setAberto(null)} />
  );
  return (
    <>
      <Voltar aoVoltar={aoVoltar} />
      <Card className="hover:translate-y-0">
        <h2 className="text-lg font-extrabold">Pedir ajuste no ponto</h2>
        <p className="mt-1 text-sm text-slate-500">Toque no dia para corrigir um horário ou incluir o que você esqueceu de bater. A empresa precisa aprovar.</p>
        {lista.isLoading ? <p className="mt-4 text-sm text-slate-500">Carregando…</p> : null}
        {lista.isError ? <div className="mt-4"><Alerta>{erroGeral(lista.error, "Não foi possível carregar suas batidas.")}</Alerta></div> : null}
        {atencao.length ? (
          <div className="mt-4 grid gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Precisa de atenção</p>
            <ul className="grid gap-2">{atencao.map(linhaDoDia)}</ul>
          </div>
        ) : null}
        {dias.length ? (
          <div className="mt-4 grid gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Seus dias</p>
            <ul className="grid gap-2">{dias.slice(0, mostrar).filter((dia) => !dia.semSaida).map(linhaDoDia)}</ul>
            {mostrar < dias.length ? (
              <Button type="button" variant="secondary" onClick={() => setMostrar(mostrar + POR_PAGINA)}>Ver dias anteriores</Button>
            ) : <p className="text-center text-xs text-slate-400">Dá para pedir ajuste dos últimos 60 dias.</p>}
          </div>
        ) : null}
      </Card>
      <Card className="hover:translate-y-0">
        <h2 className="font-extrabold">Meus pedidos</h2>
        {!pedidos.length ? <p className="mt-3 text-sm text-slate-500">Nenhum pedido ainda.</p> : (
          <ul className="mt-3 grid gap-3">
            {pedidos.map((pedido) => (
              <li key={pedido.chave} className="grid gap-1 border-t border-slate-100 pt-3 text-sm first:border-0 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{pedido.data} · {pedido.titulo}</span>
                  <Badge value={pedido.situacao.toLowerCase()}>{pedido.situacao}</Badge>
                </div>
                <span className="text-slate-500">{pedido.detalhe} · {pedido.motivo}</span>
                {pedido.resposta ? <span className="text-slate-600">Resposta da empresa: {pedido.resposta}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/** Linha do espelho: data, dia da semana e os períodos (entrada–saída). Aberta, mostra o editor do dia. */
function LinhaDia({ dia, aberto, aoAbrir, aoEnviar }: { dia: DiaEspelho; aberto: boolean; aoAbrir: () => void; aoEnviar: () => void }) {
  const fimDeSemana = ["Sáb", "Dom"].includes(diaDaSemana(dia.iso));
  return (
    <li className={`overflow-hidden rounded-xl ring-1 ${aberto ? "ring-[#6d28d9]" : dia.semSaida ? "ring-amber-300" : "ring-slate-200"} ${dia.semSaida ? "bg-amber-50/60" : "bg-white"}`}>
      <button type="button" onClick={aoAbrir} aria-expanded={aberto}
        className="grid w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50/70">
        <span className={`grid leading-tight ${fimDeSemana ? "text-slate-400" : ""}`}>
          <span className="text-xs font-semibold uppercase">{diaDaSemana(dia.iso)}</span>
          <span className="text-sm font-bold tabular-nums">{dataCurta(dia.iso)}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {dia.batidas.length ? dia.batidas.map((batida) => (
            <span key={batida.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold tabular-nums text-slate-700">
              {hhmm(batida.entrada) || "—"}
              <span className="text-slate-400">→</span>
              {batida.saida ? hhmm(batida.saida) : <span className="text-amber-700">sem saída</span>}
            </span>
          )) : <span className="text-xs text-slate-400">Sem batidas</span>}
        </span>
        <span className="flex items-center gap-1.5">
          {dia.pedidosPendentes ? <Badge value="pendente">{dia.pedidosPendentes === 1 ? "1 pedido" : `${dia.pedidosPendentes} pedidos`}</Badge> : null}
          <ChevronDown size={16} className={`text-slate-400 transition ${aberto ? "rotate-180" : ""}`} />
        </span>
      </button>
      {aberto ? <EditorDia dia={dia} aoEnviar={aoEnviar} /> : null}
    </li>
  );
}

/**
 * Editor do dia: cada período com a entrada e a saída já preenchidas; a pessoa muda só o que está errado (vira pedido
 * de ajuste) e pode incluir períodos que não bateu (vira pedido de inclusão). Um motivo só para tudo.
 */
function EditorDia({ dia, aoEnviar }: { dia: DiaEspelho; aoEnviar: () => void }) {
  const queryClient = useQueryClient();
  const [horarios, setHorarios] = useState<Record<string, string>>(() =>
    Object.fromEntries(dia.batidas.flatMap((batida) => [[`${batida.id}-entrada`, hhmm(batida.entrada)], [`${batida.id}-saida`, hhmm(batida.saida)]])));
  const [novos, setNovos] = useState<Array<{ entrada: string; saida: string }>>(() => (dia.batidas.length ? [] : [{ entrada: "", saida: "" }]));
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);
  const mudancas = dia.batidas.flatMap((batida) => (["entrada", "saida"] as const)
    .filter((tipo) => horarios[`${batida.id}-${tipo}`] && horarios[`${batida.id}-${tipo}`] !== hhmm(batida[tipo]))
    .map((tipo) => ({ idPonto: batida.id, tipo, hora: horarios[`${batida.id}-${tipo}`] })));
  const inclusoes = novos.filter((novo) => novo.entrada || novo.saida);
  const enviar = useMutation({
    mutationFn: async () => {
      // Um pedido por horário mudado e um por período incluído; para no primeiro erro e diz qual foi.
      for (const mudanca of mudancas) {
        await api("/api/v1/ponto/solicitacoes", { method: "POST", body: JSON.stringify({ ...mudanca, motivo }) })
          .catch((error) => { throw new Error(`${mudanca.tipo === "entrada" ? "Entrada" : "Saída"} ${mudanca.hora}: ${erroGeral(error, "não foi possível enviar.")}`); });
      }
      for (const novo of inclusoes) {
        await api("/api/v1/ponto/inclusoes", { method: "POST", body: JSON.stringify({ data: dia.iso, entrada: novo.entrada, saida: novo.saida, motivo }) })
          .catch((error) => { throw new Error(`Período ${novo.entrada || "?"}–${novo.saida || "?"}: ${erroGeral(error, "não foi possível enviar.")}`); });
      }
    },
    onSuccess: () => setEnviado(true),
    onError: (error) => setErro(error instanceof Error ? error.message : "Não foi possível enviar."),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ponto-solicitacoes"] });
      await queryClient.invalidateQueries({ queryKey: ["sessao-ponto"] });
    },
  });
  if (enviado) {
    return (
      <div className="grid gap-3 border-t border-slate-100 px-3 py-3">
        <Alerta tom="ok">Pedido enviado. O ponto muda só depois que a empresa aprovar; acompanhe em "Meus pedidos".</Alerta>
        <Button type="button" variant="secondary" onClick={aoEnviar}>Fechar</Button>
      </div>
    );
  }
  const nada = !mudancas.length && !inclusoes.length;
  const campoHora = (chave: string, original: string, pendente: boolean, rotulo: string) => {
    const valor = horarios[chave] ?? "";
    const mudou = valor !== original;
    return (
      <label className="grid gap-1 text-xs font-semibold text-slate-500">
        {rotulo}
        <Input type="time" aria-label={`${rotulo} ${dataCurta(dia.iso)}`} disabled={pendente} value={valor}
          className={mudou ? "border-[#6d28d9] ring-2 ring-[#6d28d9]/20" : !original ? "border-amber-400" : ""}
          onChange={(event) => { setErro(""); setHorarios({ ...horarios, [chave]: event.target.value }); }} />
        <span className="min-h-4 font-normal">
          {pendente ? <span className="text-amber-700">pedido esperando a empresa</span>
            : mudou ? <span className="text-[#5b21b6]">antes: {original || "sem horário"}</span>
            : !original ? <span className="text-amber-700">não registrada</span> : null}
        </span>
      </label>
    );
  };
  return (
    <form className="grid gap-3 border-t border-slate-100 px-3 py-3" onSubmit={(event) => { event.preventDefault(); setErro(""); enviar.mutate(); }}>
      {dia.batidas.map((batida, indice) => (
        <div key={batida.id} className="grid gap-1">
          <p className="text-xs font-bold text-slate-600">{dia.batidas.length > 1 ? `${indice + 1}º período` : "Período"}</p>
          <div className="grid grid-cols-2 gap-3">
            {campoHora(`${batida.id}-entrada`, hhmm(batida.entrada), batida.pendenteEntrada, "Entrada")}
            {campoHora(`${batida.id}-saida`, hhmm(batida.saida), batida.pendenteSaida, "Saída")}
          </div>
        </div>
      ))}
      {novos.map((novo, indice) => (
        <div key={indice} className="grid gap-1 rounded-lg bg-violet-50/60 p-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#5b21b6]">Período que não bati</p>
            <button type="button" className="text-xs font-semibold text-slate-500 hover:text-rose-700" onClick={() => setNovos(novos.filter((_, i) => i !== indice))}>Remover</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(["entrada", "saida"] as const).map((tipo) => (
              <label key={tipo} className="grid gap-1 text-xs font-semibold text-slate-500">
                {tipo === "entrada" ? "Entrada" : "Saída"}
                <Input type="time" required aria-label={`${tipo === "entrada" ? "Entrada" : "Saída"} do período incluído`} value={novo[tipo]}
                  onChange={(event) => { setErro(""); setNovos(novos.map((item, i) => (i === indice ? { ...item, [tipo]: event.target.value } : item))); }} />
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-[#5b21b6] hover:underline"
        onClick={() => setNovos([...novos, { entrada: "", saida: "" }])}>
        <Plus size={15} /> Incluir período que não bati
      </button>
      <Field label="Motivo">
        <Textarea required maxLength={255} rows={2} placeholder="Ex.: esqueci de bater a saída; o celular ficou sem internet." value={motivo} onChange={(event) => setMotivo(event.target.value)} />
      </Field>
      {erro ? <Alerta>{erro}</Alerta> : null}
      <Button type="submit" className="h-11" disabled={enviar.isPending || nada}>
        {enviar.isPending ? "Enviando…" : nada ? "Mude um horário ou inclua um período" : `Enviar ${mudancas.length + inclusoes.length === 1 ? "pedido" : `${mudancas.length + inclusoes.length} pedidos`}`}
      </Button>
    </form>
  );
}

function mascaraCpf(valor: string) {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  return digitos
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function horaSp() {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
}
