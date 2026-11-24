import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { filtrar } from "../lib/busca";
import { Janela } from "../components/janela";
import { Alerta, Badge, Button, CabecalhoPagina, Card, Empty, Field, Resumo, Skeleton, Textarea, cn } from "../components/ui";
import { CampoBusca } from "./consultas";

type Pedido = {
  origem: "ajuste" | "inclusao"; id: number; id_candidato: string; nome: string; data: string; tipo: string;
  registrado: string; atual: string; pedido: string; motivo: string; situacao: "Pendente" | "Aprovada" | "Recusada"; resposta: string;
};

export const CHAVE_SOLICITACOES = "/api/v1/empresa/ponto/solicitacoes";

/**
 * Pedidos de ajuste de ponto feitos pelos colaboradores no app. Aprovar grava o horário corrigido e mantém a marcação
 * original guardada (Portaria 671/2021); recusar exige dizer o motivo para a pessoa.
 */
export function SolicitacoesPonto() {
  const [situacao, setSituacao] = useState<"pendentes" | "todas">("pendentes");
  const [busca, setBusca] = useState("");
  const [respondendo, setRespondendo] = useState<{ pedido: Pedido; aprovar: boolean } | null>(null);
  const lista = useQuery({ queryKey: [CHAVE_SOLICITACOES, situacao], queryFn: () => api<Pedido[]>(`${CHAVE_SOLICITACOES}?situacao=${situacao}`) });
  const linhas = filtrar(lista.data?.data ?? [], busca, ["nome", "data", "tipo", "motivo", "situacao"]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo="Solicitações de ajuste"
        descricao="Pedidos dos colaboradores para corrigir uma batida. Ao aprovar, o horário corrigido passa a valer no relatório; a marcação original continua guardada, como pede a lei."
      />
      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" role="group" aria-label="Situação">
          {([["pendentes", "Pendentes"], ["todas", "Todas"]] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={situacao === valor} onClick={() => setSituacao(valor)}
              className={cn("inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold ring-1 transition", situacao === valor ? "bg-violet-700 text-white ring-violet-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
              {rotulo}
            </button>
          ))}
        </div>
        <div className="flex min-w-[14rem] flex-1"><CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar colaborador, data, motivo…" /></div>
      </Card>
      {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar os pedidos."}</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-60" /> : null}
      {!lista.isLoading && !lista.isError ? (
        <>
          <Resumo total={linhas.length} singular="pedido" plural="pedidos" />
          {!linhas.length ? (
            <Empty
              titulo={busca ? "Nada encontrado" : situacao === "pendentes" ? "Nenhum pedido esperando" : "Nenhum pedido"}
              texto={busca ? "Confira a grafia ou limpe a busca." : "Os pedidos que os colaboradores fizerem no app do ponto aparecem aqui."}
            />
          ) : (
            <div className="grid gap-3">
              {linhas.map((pedido) => (
                <Card key={`${pedido.origem}-${pedido.id}`} className="grid gap-3 hover:translate-y-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="grid gap-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/ponto/colaborador/${pedido.id_candidato}`} className="font-semibold text-violet-700 hover:underline">{pedido.nome}</Link>
                      <Badge value={pedido.situacao.toLowerCase()}>{pedido.situacao}</Badge>
                    </div>
                    {pedido.origem === "inclusao" ? (
                      <p className="text-slate-700">{pedido.data} · Incluir marcação esquecida: <b>{pedido.pedido}</b></p>
                    ) : (
                      <p className="text-slate-700">
                        {pedido.data} · {pedido.tipo}: registrada <b>{pedido.registrado.slice(0, 5) || "sem horário"}</b>, pedido <b>{pedido.pedido}</b>
                        {pedido.situacao === "Aprovada" && pedido.atual ? <span className="text-slate-500"> (vale {pedido.atual.slice(0, 5)})</span> : null}
                      </p>
                    )}
                    <p className="text-slate-500">Motivo: {pedido.motivo || "—"}</p>
                    {pedido.resposta ? <p className="text-slate-500">Resposta: {pedido.resposta}</p> : null}
                  </div>
                  {pedido.situacao === "Pendente" ? (
                    <div className="flex gap-2">
                      <Button type="button" onClick={() => setRespondendo({ pedido, aprovar: true })}><Check size={16} /> Aprovar</Button>
                      <Button type="button" variant="secondary" onClick={() => setRespondendo({ pedido, aprovar: false })}><X size={16} /> Recusar</Button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}
      {respondendo ? <Responder {...respondendo} aoFechar={() => setRespondendo(null)} /> : null}
    </div>
  );
}

function Responder({ pedido, aprovar, aoFechar }: { pedido: Pedido; aprovar: boolean; aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const [resposta, setResposta] = useState("");
  const [erro, setErro] = useState("");
  const enviar = useMutation({
    mutationFn: () => api(`${pedido.origem === "inclusao" ? "/api/v1/empresa/ponto/inclusoes" : CHAVE_SOLICITACOES}/${pedido.id}`, { method: "POST", body: JSON.stringify({ aprovar, resposta }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [CHAVE_SOLICITACOES] });
      aoFechar();
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível responder."),
  });
  return (
    <Janela titulo={aprovar ? "Aprovar ajuste" : "Recusar ajuste"} aberta onFechar={aoFechar}>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setErro(""); enviar.mutate(); }}>
        {pedido.origem === "inclusao" ? (
          <p className="text-sm text-slate-600">
            {pedido.nome}, {pedido.data}: incluir o período <b>{pedido.pedido}</b>, que a pessoa não bateu.
            {aprovar ? " A marcação entra no ponto identificada como incluída (sem horário do relógio) e passa a contar nas horas e no saldo." : " Nada entra no ponto."}
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            {pedido.nome}, {pedido.data}: {pedido.tipo.toLowerCase()} de <b>{pedido.registrado.slice(0, 5) || "sem horário"}</b> para <b>{pedido.pedido}</b>.
            {aprovar ? " O novo horário passa a contar nas horas e no saldo." : " A batida fica como está."}
          </p>
        )}
        <Field label={aprovar ? "Mensagem ao colaborador (opcional)" : "Motivo da recusa"}>
          <Textarea rows={3} maxLength={255} required={!aprovar} value={resposta} onChange={(event) => setResposta(event.target.value)} />
        </Field>
        {erro ? <Alerta>{erro}</Alerta> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" disabled={enviar.isPending}>{enviar.isPending ? "Salvando…" : aprovar ? "Aprovar" : "Recusar"}</Button>
        </div>
      </form>
    </Janela>
  );
}
