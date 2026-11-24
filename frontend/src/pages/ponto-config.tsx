import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, KeyRound, Plane, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { dataBr } from "../lib/formato";
import { Janela } from "../components/janela";
import { Alerta, Badge, Button, Card, Field, Input, Select } from "../components/ui";
import { useJornadas } from "./jornadas";

type Configuracao = { noPonto: boolean; jornada: string; ferias: Array<{ id: number; inicio: string; fim: string }> };

const chaveConfig = (id: string) => ["ponto-config", id];
const mensagem = (erro: unknown, padrao: string) => (erro instanceof ApiError ? erro.message : padrao);

function useConfiguracao(id: string) {
  return useQuery({ queryKey: chaveConfig(id), queryFn: () => api<Configuracao>(`/api/v1/empresa/ponto/colaborador/${encodeURIComponent(id)}/configuracao`) });
}

/** Depois de mexer na configuração, o relatório, a lista e a própria configuração recarregam. */
function useRecarregar(id: string) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: chaveConfig(id) }),
      client.invalidateQueries({ queryKey: ["ponto-colaborador", id] }),
      client.invalidateQueries({ queryKey: ["/api/v1/empresa/ponto/colaboradores"] }),
    ]);
  };
}

/**
 * Botão do cabeçalho. "Apagar" desliga a pessoa: ela sai da lista e não bate mais ponto, mas os registros ficam guardados,
 * porque a empresa é obrigada a manter o ponto (Portaria MTP 671/2021; a CLT permite cobrar até 5 anos para trás).
 * Desligada, a pessoa aparece só no filtro "Desligados", com o botão Reativar.
 */
export function ApagarColaborador({ id, nome, desligado, aoReativar }: { id: string; nome: string; desligado: boolean; aoReativar: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [aberta, setAberta] = useState(false);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  // Último dia em que a pessoa trabalhou: depois dele o relatório não conta falta.
  const [ultimoDia, setUltimoDia] = useState(hoje);
  const alterar = useMutation({
    mutationFn: () => api(`/api/v1/empresa/ponto/colaborador/${encodeURIComponent(id)}/desligar`, { method: "POST", body: JSON.stringify({ ultimoDia }) }),
    onSuccess: async () => {
      setAberta(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: chaveConfig(id) }),
        client.invalidateQueries({ queryKey: ["ponto-colaborador", id] }),
        client.invalidateQueries({ queryKey: ["/api/v1/empresa/ponto/colaboradores"] }),
      ]);
      navigate("/ponto/colaboradores", { replace: true });
    },
  });
  // Reativar abre o cadastro preenchido: a pessoa volta como nova (passagem nova, sem saldo nem banco de horas antigos).
  if (desligado) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge value="Desligado">Desligado</Badge>
        <Button variant="secondary" onClick={aoReativar}><RotateCcw size={16} aria-hidden /> Reativar</Button>
      </div>
    );
  }
  return (
    <>
      <Button variant="secondary" className="text-red-700" onClick={() => { alterar.reset(); setAberta(true); }}>
        <Trash2 size={16} aria-hidden /> Apagar colaborador
      </Button>
      <Janela titulo={`Apagar ${nome}?`} aberta={aberta} onFechar={() => { if (!alterar.isPending) setAberta(false); }}>
        <div className="grid gap-4">
          <p className="text-sm text-slate-600">
            A pessoa sai da lista de colaboradores e não consegue mais bater ponto.
          </p>
          <Field label="Último dia de trabalho" erro={alterar.error instanceof ApiError ? alterar.error.campos?.ultimoDia : undefined}>
            <Input type="date" value={ultimoDia} max={hoje} required onChange={(event) => setUltimoDia(event.target.value)} />
            <span className="text-xs text-slate-500">Depois desse dia o relatório não conta falta.</span>
          </Field>
          <Alerta tom="info">
            As batidas, o banco de horas, as férias e os atestados ficam guardados, porque a lei obriga a empresa a manter os
            registros de ponto. Se precisar do espelho de ponto dela, ela fica no filtro <strong>Desligados</strong>.
          </Alerta>
          {alterar.error ? <Alerta>{mensagem(alterar.error, "Não foi possível apagar o colaborador.")}</Alerta> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setAberta(false)} disabled={alterar.isPending}>Voltar</Button>
            <Button variant="danger" onClick={() => alterar.mutate()} disabled={alterar.isPending}>{alterar.isPending ? "Apagando…" : "Apagar colaborador"}</Button>
          </div>
        </div>
      </Janela>
    </>
  );
}

/**
 * Nova senha provisória do app do ponto: para quem esqueceu a senha ou ainda não tinha uma.
 * A pessoa entra com ela e é obrigada a criar a própria senha.
 */
export function RedefinirSenha({ id, nome }: { id: string; nome: string }) {
  const [aberta, setAberta] = useState(false);
  const [senha, setSenha] = useState("");
  const salvar = useMutation({
    mutationFn: () => api(`/api/v1/empresa/ponto/colaborador/${encodeURIComponent(id)}/senha`, { method: "POST", body: JSON.stringify({ senha }) }),
    onSuccess: () => setSenha(""),
  });
  const fechar = () => { if (!salvar.isPending) { setAberta(false); setSenha(""); salvar.reset(); } };
  return (
    <>
      <Button variant="secondary" onClick={() => { salvar.reset(); setAberta(true); }}>
        <KeyRound size={16} aria-hidden /> Senha do ponto
      </Button>
      <Janela titulo={`Nova senha para ${nome}`} aberta={aberta} onFechar={fechar}>
        {salvar.isSuccess ? (
          <div className="grid gap-4">
            <Alerta tom="ok">Senha provisória salva. Passe para a pessoa: ela entra no app com o CPF e essa senha e cria a dela.</Alerta>
            <div className="flex justify-end"><Button onClick={fechar}>Fechar</Button></div>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); salvar.mutate(); }}>
            <p className="text-sm text-slate-600">Use quando a pessoa esqueceu a senha ou ainda não tem acesso ao app do ponto. A senha atual deixa de valer.</p>
            <Field label="Senha provisória" erro={salvar.error instanceof ApiError ? salvar.error.campos?.senha : undefined}>
              <Input type="password" autoComplete="new-password" minLength={6} required value={senha} onChange={(event) => setSenha(event.target.value)} />
              <span className="text-xs text-slate-500">Pelo menos 6 caracteres. No primeiro login a pessoa troca por uma dela.</span>
            </Field>
            {salvar.error && !(salvar.error instanceof ApiError && salvar.error.campos?.senha) ? <Alerta>{mensagem(salvar.error, "Não foi possível salvar a senha.")}</Alerta> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={fechar}>Voltar</Button>
              <Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar senha"}</Button>
            </div>
          </form>
        )}
      </Janela>
    </>
  );
}

/** Blocos de jornada de trabalho e férias (recesso, para estagiário) da pessoa, acima do relatório. */
export function ConfiguracaoPonto({ id, estagio, desligado }: { id: string; estagio: boolean; desligado: boolean }) {
  const config = useConfiguracao(id);
  // Desligado: só o relatório (somente leitura), para a empresa tirar o espelho de ponto.
  if (desligado) return <Alerta tom="info">Colaborador desligado. Os registros ficam guardados aqui para consulta; para mudar jornada ou férias, reative.</Alerta>;
  if (config.isError) return <Alerta>{mensagem(config.error, "Não foi possível carregar a configuração do ponto.")}</Alerta>;
  if (!config.data) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Jornada id={id} atual={config.data.data} estagio={estagio} />
      <Ferias id={id} periodos={config.data.data.ferias} estagio={estagio} />
    </div>
  );
}

function Jornada({ id, atual, estagio }: { id: string; atual: Configuracao; estagio: boolean }) {
  const jornadas = useJornadas();
  const recarregar = useRecarregar(id);
  const [jornada, setJornada] = useState(atual.jornada);
  const [salvo, setSalvo] = useState(false);
  useEffect(() => { setJornada(atual.jornada); }, [atual.jornada]);
  const salvar = useMutation({
    mutationFn: () => api(`/api/v1/empresa/ponto/colaborador/${encodeURIComponent(id)}/jornada`, { method: "POST", body: JSON.stringify({ jornada }) }),
    onSuccess: async () => {
      setSalvo(true);
      await recarregar();
    },
  });
  // Jornadas da modalidade da pessoa (estágio ou CLT) e as antigas, sem modalidade; a atual aparece sempre.
  const lista = (jornadas.data?.data ?? []).filter((item) => !item.modalidade || item.modalidade === (estagio ? "1" : "2") || String(item.id) === atual.jornada);
  const escolhida = lista.find((item) => String(item.id) === jornada);
  const campos = salvar.error instanceof ApiError ? salvar.error.campos ?? {} : {};
  const mudou = jornada !== atual.jornada;
  return (
    <Card className="grid content-start gap-4 md:p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-violet-50 p-2 text-violet-700"><CalendarDays size={18} /></span>
        <div>
          <h2 className="text-sm font-extrabold text-ink">Jornada de trabalho</h2>
          <p className="text-xs text-slate-500">Os dias e o horário de trabalho da pessoa. Sem jornada, todo dia aparece como folga.</p>
        </div>
      </div>
      {!jornadas.isLoading && !lista.length ? (
        <Alerta>Cadastre antes <Link className="font-bold underline" to="/jornadas?novo=1">uma jornada de trabalho</Link>.</Alerta>
      ) : null}
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); setSalvo(false); salvar.mutate(); }}>
        <Field label="Jornada" erro={campos.jornada}>
          <Select aria-label="Jornada" value={jornada} onChange={(event) => { setSalvo(false); setJornada(event.target.value); }}>
            <option value="">Selecione</option>
            {lista.map((item) => (
              <option key={item.id} value={String(item.id)} disabled={!item.completa}>
                {item.nome}{item.completa ? "" : " (sem horário em algum dia)"}
              </option>
            ))}
          </Select>
        </Field>
        {escolhida ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-600">
            {escolhida.resumo || "Nenhum dia de trabalho"}
            {escolhida.completa ? null : <> · <Link className="font-semibold text-violet-700 underline" to="/jornadas">complete o horário</Link></>}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={salvar.isPending || !mudou || !jornada}>{salvar.isPending ? "Salvando…" : "Salvar jornada"}</Button>
          {salvo && !mudou ? <span className="text-sm font-semibold text-emerald-700" role="status">Jornada salva.</span> : null}
          {salvar.error && !campos.jornada ? <span className="text-sm font-semibold text-red-700" role="alert">{mensagem(salvar.error, "Não foi possível salvar.")}</span> : null}
        </div>
      </form>
    </Card>
  );
}

/**
 * Férias da CLT ou, para estagiário, recesso (Lei 11.788/2008, art. 13): 30 dias a cada ano de estágio, proporcional se o
 * contrato for menor, remunerado quando há bolsa e de preferência nas férias escolares. Os dois usam dna_work.ferias.
 */
function Ferias({ id, periodos, estagio }: { id: string; periodos: Configuracao["ferias"]; estagio: boolean }) {
  const nome = estagio ? "Recesso" : "Férias";
  const deNome = estagio ? "do recesso" : "das férias";
  const recarregar = useRecarregar(id);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const adicionar = useMutation({
    mutationFn: () => api(`/api/v1/empresa/ponto/colaborador/${encodeURIComponent(id)}/ferias`, { method: "POST", body: JSON.stringify({ inicio, fim }) }),
    onSuccess: async () => {
      setInicio("");
      setFim("");
      await recarregar();
    },
  });
  const excluir = useMutation({
    mutationFn: (idFerias: number) => api(`/api/v1/empresa/ponto/colaborador/${encodeURIComponent(id)}/ferias/${idFerias}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmando(null);
      await recarregar();
    },
  });
  const campos = adicionar.error instanceof ApiError ? adicionar.error.campos ?? {} : {};
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return (
    <Card className="grid content-start gap-4 md:p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-sky-50 p-2 text-sky-700"><Plane size={18} /></span>
        <div>
          <h2 className="text-sm font-extrabold text-ink">{nome}</h2>
          <p className="text-xs text-slate-500">Nesses dias o ponto não deixa bater, e o relatório mostra "{nome}" sem contar horas.</p>
        </div>
      </div>
      {estagio ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
          Estagiário não tem férias, tem <strong>recesso</strong> (Lei 11.788/2008): 30 dias a cada ano de estágio, proporcional
          se o contrato for menor, pago quando há bolsa e de preferência nas férias escolares. Não pode ser vendido.
        </p>
      ) : null}
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); adicionar.mutate(); }}>
        <Field label="Primeiro dia" erro={campos.inicio}><Input aria-label={`Primeiro dia ${deNome}`} type="date" value={inicio} onChange={(event) => setInicio(event.target.value)} /></Field>
        <Field label="Último dia" erro={campos.fim}><Input aria-label={`Último dia ${deNome}`} type="date" value={fim} min={inicio || undefined} onChange={(event) => setFim(event.target.value)} /></Field>
        <Button type="submit" className="h-10" disabled={adicionar.isPending}>{adicionar.isPending ? "Salvando…" : "Adicionar"}</Button>
      </form>
      {adicionar.error && !Object.keys(campos).length ? <p className="text-sm font-semibold text-red-700" role="alert">{mensagem(adicionar.error, `Não foi possível salvar ${estagio ? "o recesso" : "as férias"}.`)}</p> : null}
      {excluir.error ? <p className="text-sm font-semibold text-red-700" role="alert">{mensagem(excluir.error, `Não foi possível excluir ${estagio ? "o recesso" : "as férias"}.`)}</p> : null}
      {periodos.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {periodos.map((periodo) => {
            const agora = periodo.inicio <= hoje && periodo.fim >= hoje;
            return (
              <li key={periodo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-semibold tabular-nums text-ink">{dataBr(periodo.inicio)} a {dataBr(periodo.fim)}</span>
                {agora ? <Badge value={nome}>{estagio ? "Em recesso" : "Em férias"}</Badge> : null}
                <span className="ml-auto">
                  {confirmando === periodo.id ? (
                    <span className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-ink">Excluir?</span>
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirmando(null)}>Voltar</Button>
                      <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => excluir.mutate(periodo.id)} disabled={excluir.isPending}>Excluir</Button>
                    </span>
                  ) : (
                    <Button variant="ghost" className="px-2 py-1 text-slate-500 hover:text-red-700" aria-label={`Excluir ${nome.toLowerCase()} de ${dataBr(periodo.inicio)} a ${dataBr(periodo.fim)}`} onClick={() => { excluir.reset(); setConfirmando(periodo.id); }}>
                      <Trash2 size={16} />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-slate-500">{estagio ? "Nenhum recesso cadastrado." : "Nenhuma férias cadastrada."}</p>}
    </Card>
  );
}
