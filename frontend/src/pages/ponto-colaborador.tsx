import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, MessageSquarePlus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alerta, Badge, Button, Card, Field, Input, Select, Textarea } from "../components/ui";
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

type BatidaAjustavel = { id: number; data: string; entrada: string | null; saida: string | null; pendenteEntrada: boolean; pendenteSaida: boolean };
type PedidoPonto = { chave: string; origem: "ajuste" | "inclusao"; data: string; titulo: string; detalhe: string; motivo: string; situacao: "Pendente" | "Aprovada" | "Recusada"; resposta: string | null };
type ListaSolicitacoes = { pedidos: PedidoPonto[]; batidas: BatidaAjustavel[] };

const hojeIsoSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somarDias = (iso: string, dias: number) => {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};
const erroDoCampo = (error: unknown) => (error instanceof ApiError ? error.campos ?? {} : {});
const erroGeral = (error: unknown, padrao: string) => (error instanceof ApiError ? (Object.keys(error.campos ?? {}).length ? "" : error.message) : padrao);

/**
 * Pedidos do colaborador: corrigir o horário de uma batida ou incluir um período que ele esqueceu de bater.
 * Nada muda no ponto até a empresa aprovar (a lei não deixa o sistema criar ou mudar marcação sozinho).
 */
function SolicitacoesColaborador({ aoVoltar, batidaInicial }: { aoVoltar: () => void; batidaInicial?: string | null }) {
  const lista = useQuery({ queryKey: ["ponto-solicitacoes"], queryFn: () => api<ListaSolicitacoes>("/api/v1/ponto/solicitacoes") });
  const [modo, setModo] = useState<"ajuste" | "inclusao">("ajuste");
  const pedidos = lista.data?.data.pedidos ?? [];
  return (
    <>
      <Voltar aoVoltar={aoVoltar} />
      <Card className="hover:translate-y-0">
        <h2 className="text-lg font-extrabold">Pedir ajuste no ponto</h2>
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Tipo de pedido">
          {([["ajuste", "Corrigir uma batida"], ["inclusao", "Incluir marcação esquecida"]] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={modo === valor} onClick={() => setModo(valor)}
              className={`min-h-10 rounded-lg px-3 text-sm font-semibold ring-1 transition ${modo === valor ? "bg-[#6d28d9] text-white ring-[#6d28d9]" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}>
              {rotulo}
            </button>
          ))}
        </div>
        {modo === "ajuste"
          ? <PedidoAjuste batidas={lista.data?.data.batidas ?? []} carregando={lista.isLoading} batidaInicial={batidaInicial} />
          : <PedidoInclusao />}
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

/** Corrigir o horário de uma batida que existe (bateu errado ou esqueceu a saída). */
function PedidoAjuste({ batidas, carregando, batidaInicial }: { batidas: BatidaAjustavel[]; carregando: boolean; batidaInicial?: string | null }) {
  const queryClient = useQueryClient();
  const inicial = batidas.find((item) => String(item.id) === batidaInicial);
  const [idPonto, setIdPonto] = useState(inicial ? String(inicial.id) : "");
  const [tipo, setTipo] = useState<"entrada" | "saida">(inicial && !inicial.saida ? "saida" : "entrada");
  const [hora, setHora] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviado, setEnviado] = useState(false);
  // A lista chega depois da tela: quando o aviso de "saída pendente" trouxe a batida, seleciona assim que carregar.
  useEffect(() => {
    if (inicial && !idPonto) { setIdPonto(String(inicial.id)); if (!inicial.saida) setTipo("saida"); }
  }, [inicial, idPonto]);
  const batida = batidas.find((item) => String(item.id) === idPonto);
  const pendente = batida ? (tipo === "entrada" ? batida.pendenteEntrada : batida.pendenteSaida) : false;
  const enviar = useMutation({
    mutationFn: () => api("/api/v1/ponto/solicitacoes", { method: "POST", body: JSON.stringify({ idPonto: Number(idPonto), tipo, hora, motivo }) }),
    onSuccess: async () => {
      setIdPonto(""); setHora(""); setMotivo(""); setEnviado(true);
      await queryClient.invalidateQueries({ queryKey: ["ponto-solicitacoes"] });
      await queryClient.invalidateQueries({ queryKey: ["sessao-ponto"] });
    },
  });
  const campos = erroDoCampo(enviar.error);
  const escolherBatida = (valor: string) => {
    setIdPonto(valor);
    setEnviado(false);
    const escolhida = batidas.find((item) => String(item.id) === valor);
    // Sem saída registrada, o pedido mais comum é justamente a saída esquecida.
    if (escolhida && !escolhida.saida) setTipo("saida");
  };
  if (carregando) return <p className="mt-4 text-sm text-slate-500">Carregando…</p>;
  if (!batidas.length) return <p className="mt-4 text-sm text-slate-500">Você não tem batidas nos últimos 60 dias. Se esqueceu de bater o dia todo, use "Incluir marcação esquecida".</p>;
  return (
    <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); setEnviado(false); enviar.mutate(); }}>
      <p className="text-sm text-slate-500">Bateu no horário errado ou esqueceu a saída? Escolha a batida e informe o horário certo.</p>
      <Field label="Batida" erro={campos.idPonto}>
        <Select required value={idPonto} onChange={(event) => escolherBatida(event.target.value)}>
          <option value="">Escolha o dia</option>
          {batidas.map((item) => (
            <option key={item.id} value={item.id}>{item.data} · entrada {item.entrada?.slice(0, 5) || "—"} · saída {item.saida?.slice(0, 5) || "não registrada"}</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="O que corrigir">
          <Select value={tipo} onChange={(event) => setTipo(event.target.value as "entrada" | "saida")}>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </Select>
        </Field>
        <Field label="Horário certo" erro={campos.hora}>
          <Input type="time" required value={hora} onChange={(event) => setHora(event.target.value)} />
        </Field>
      </div>
      {batida ? <p className="text-xs text-slate-500">Registrado: {(tipo === "entrada" ? batida.entrada : batida.saida)?.slice(0, 5) || "nenhum horário"}</p> : null}
      <Field label="Motivo" erro={campos.motivo}>
        <Textarea required maxLength={255} rows={3} placeholder="Ex.: esqueci de bater a saída; o celular ficou sem internet." value={motivo} onChange={(event) => setMotivo(event.target.value)} />
      </Field>
      {pendente ? <Alerta tom="aviso">Já existe um pedido para essa batida esperando a empresa.</Alerta> : null}
      {enviar.error && erroGeral(enviar.error, "Não foi possível enviar o pedido.") ? <Alerta>{erroGeral(enviar.error, "Não foi possível enviar o pedido.")}</Alerta> : null}
      {enviado ? <Alerta tom="ok">Pedido enviado. Acompanhe a resposta em "Meus pedidos".</Alerta> : null}
      <Button type="submit" className="h-12" disabled={enviar.isPending || pendente}>{enviar.isPending ? "Enviando…" : "Enviar pedido"}</Button>
    </form>
  );
}

/** Incluir um período que a pessoa não bateu (entrada e saída), por exemplo o dia inteiro ou a manhã. */
function PedidoInclusao() {
  const queryClient = useQueryClient();
  const hoje = hojeIsoSp();
  const [data, setData] = useState("");
  const [entrada, setEntrada] = useState("");
  const [saida, setSaida] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviado, setEnviado] = useState(false);
  const enviar = useMutation({
    mutationFn: () => api("/api/v1/ponto/inclusoes", { method: "POST", body: JSON.stringify({ data, entrada, saida, motivo }) }),
    onSuccess: async () => {
      setData(""); setEntrada(""); setSaida(""); setMotivo(""); setEnviado(true);
      await queryClient.invalidateQueries({ queryKey: ["ponto-solicitacoes"] });
    },
  });
  const campos = erroDoCampo(enviar.error);
  return (
    <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); setEnviado(false); enviar.mutate(); }}>
      <p className="text-sm text-slate-500">
        Esqueceu de bater a entrada e a saída de um período (o dia todo ou só a manhã, por exemplo)? Informe o dia e os
        horários em que trabalhou. Se chegou sem bater e ainda está trabalhando, bata a entrada agora e depois peça para
        corrigir o horário dela em "Corrigir uma batida".
      </p>
      <Field label="Dia" erro={campos.data}>
        <Input type="date" required min={somarDias(hoje, -60)} max={hoje} value={data} onChange={(event) => setData(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entrada" erro={campos.entrada}>
          <Input type="time" required value={entrada} onChange={(event) => setEntrada(event.target.value)} />
        </Field>
        <Field label="Saída" erro={campos.saida}>
          <Input type="time" required value={saida} onChange={(event) => setSaida(event.target.value)} />
        </Field>
      </div>
      <Field label="Motivo" erro={campos.motivo}>
        <Textarea required maxLength={255} rows={3} placeholder="Ex.: esqueci de bater pela manhã; fiquei sem bateria." value={motivo} onChange={(event) => setMotivo(event.target.value)} />
      </Field>
      {enviar.error && erroGeral(enviar.error, "Não foi possível enviar o pedido.") ? <Alerta>{erroGeral(enviar.error, "Não foi possível enviar o pedido.")}</Alerta> : null}
      {enviado ? <Alerta tom="ok">Pedido enviado. A marcação só entra no ponto depois que a empresa aprovar.</Alerta> : null}
      <Button type="submit" className="h-12" disabled={enviar.isPending}>{enviar.isPending ? "Enviando…" : "Enviar pedido"}</Button>
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
