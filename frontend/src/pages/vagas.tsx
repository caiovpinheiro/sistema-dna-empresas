import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Check, ChevronRight, GraduationCap, MapPin, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { dataBr, dinheiro, haQuantoTempo } from "../lib/formato";
import { Alerta, Badge, Bloco, Button, CabecalhoPagina, Card, Empty, Field, FiltroChips, Input, Select, Skeleton, Textarea, botao, chave, cn } from "../components/ui";
import { CampoBusca, type VagaLinha } from "./consultas";

type Situacao = "aberta" | "pausada" | "contratada" | "fechada" | "todas";
export type TipoVaga = "1" | "2";

const TIPOS: Record<TipoVaga, { nome: string; texto: string; icone: typeof Briefcase; salario: string; carga: string }> = {
  "1": { nome: "Estágio", texto: "Para estudantes. Bolsa-auxílio e contrato com a instituição de ensino.", icone: GraduationCap, salario: "Bolsa-auxílio", carga: "Ex.: 30 horas semanais" },
  "2": { nome: "CLT", texto: "Carteira assinada, com os direitos da CLT.", icone: Briefcase, salario: "Salário", carga: "Ex.: 44 horas semanais" },
};

/** Primeira opção de abrir vaga liberada para o usuário, ou null. */
export function linkAbrirVaga(tipos: TipoVaga[]) {
  return tipos.length ? `/vagas/nova?tipo=${tipos.includes("1") ? "1" : tipos[0]}` : null;
}

export function VagasPage({ tipos }: { tipos: TipoVaga[] }) {
  const [texto, setTexto] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("aberta");
  const lista = useQuery({ queryKey: ["/api/v1/empresa/vagas", ""], queryFn: () => api<VagaLinha[]>("/api/v1/empresa/vagas?q=") });
  const todas = lista.data?.data ?? [];
  const contagem = (id: Situacao) => (id === "todas" ? todas.length : todas.filter((vaga) => chave(vaga.situacao) === id).length);
  const termo = texto.trim().toLowerCase();
  const linhas = todas.filter((vaga) => (situacao === "todas" || chave(vaga.situacao) === situacao)
    && (!termo || [vaga.cargo, vaga.cidade, vaga.codigo, vaga.contrato].some((campo) => (campo ?? "").toLowerCase().includes(termo))));
  const abrir = linkAbrirVaga(tipos);
  const opcoes = (["aberta", "pausada", "contratada", "fechada", "todas"] as Situacao[])
    .map((id) => ({ id, rotulo: { aberta: "Em aberto", pausada: "Pausadas", contratada: "Contratadas", fechada: "Encerradas", todas: "Todas" }[id], contagem: lista.isLoading ? undefined : contagem(id) }))
    .filter((opcao) => opcao.id === "aberta" || opcao.id === "todas" || (opcao.contagem ?? 0) > 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo="Vagas"
        descricao="Acompanhe as vagas da empresa com a DNA Work. Clique no cargo para ver todos os detalhes."
        acoes={abrir ? <Link to={abrir} className={botao("primary", "botao")}><Plus size={16} /> Abrir vaga</Link> : null}
      />
      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[16rem] flex-1"><CampoBusca valor={texto} onChange={setTexto} placeholder="Buscar por cargo, cidade ou código" /></div>
        <FiltroChips rotulo="Situação da vaga" valor={situacao} onChange={setSituacao} opcoes={opcoes} />
      </Card>
      {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar as vagas."}</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-64" /> : null}
      {!lista.isLoading && !lista.isError && linhas.length === 0 ? (
        termo ? <Empty titulo="Nenhuma vaga encontrada" texto="Confira a grafia ou limpe a busca." />
          : situacao === "aberta" ? <Empty titulo="Nenhuma vaga em aberto" texto="Quando precisar contratar, abra uma vaga e a DNA Work começa a seleção." acao={abrir ? <Link to={abrir} className={botao("primary", "botao")}><Plus size={16} /> Abrir vaga</Link> : null} />
            : <Empty titulo="Nenhuma vaga nesta situação" texto="Troque a situação para ver as outras vagas." />
      ) : null}
      {linhas.length ? (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr><th>Cargo</th><th>Modalidade</th><th className="text-center">Posições</th><th className="text-right">Salário / bolsa</th><th>Cidade</th><th>Abertura</th><th>Situação</th><th><span className="sr-only">Abrir</span></th></tr>
              </thead>
              <tbody>
                {linhas.map((vaga) => (
                  <tr key={vaga.id}>
                    <td className="max-w-72">
                      <Link className="block truncate" to={`/vagas/${vaga.id}`}>{vaga.cargo || "Vaga"}</Link>
                      <p className="text-xs text-slate-500">{[codigoCurto(vaga.codigo) ? `Código ${vaga.codigo}` : null, vaga.aceita_medio ? "Aceita ensino médio" : null].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td>{vaga.contrato ? <Badge value={vaga.contrato}>{vaga.contrato}</Badge> : <span className="text-slate-400">—</span>}</td>
                    <td className="text-center tabular-nums">{vaga.vagas ?? "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{dinheiro(vaga.salario)}</td>
                    <td>{vaga.cidade || <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap">
                      <p className="tabular-nums">{dataBr(vaga.dataabertura)}</p>
                      {chave(vaga.situacao) === "aberta" && haQuantoTempo(vaga.dataabertura) ? <p className="text-xs text-slate-500">{haQuantoTempo(vaga.dataabertura)}</p> : null}
                    </td>
                    <td><Badge value={vaga.situacao}>{vaga.situacao}</Badge></td>
                    <td className="w-px whitespace-nowrap text-right"><Link to={`/vagas/${vaga.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 lg:hidden">
            {linhas.map((vaga) => (
              <li key={vaga.id}>
                <Link to={`/vagas/${vaga.id}`} className="grid gap-2 px-4 py-3.5 transition hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-violet-800">{vaga.cargo || "Vaga"}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} /> {vaga.cidade || "Cidade não informada"}</p>
                    </div>
                    <Badge value={vaga.situacao}>{vaga.situacao}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                    {vaga.contrato ? <Badge value={vaga.contrato}>{vaga.contrato}</Badge> : null}
                    {vaga.aceita_medio ? <span className="text-xs font-semibold text-violet-700">Aceita ensino médio</span> : null}
                    <span className="inline-flex items-center gap-1"><Users size={13} /> {vaga.vagas ?? "—"}</span>
                    <span className="tabular-nums">{dinheiro(vaga.salario)}</span>
                    <span className="text-xs text-slate-500">Aberta em {dataBr(vaga.dataabertura)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function codigoCurto(codigo: string | null) {
  return Boolean(codigo && codigo.length <= 12);
}

type Valores = {
  cargo: string; quantidade: string; salario: string; cargaHoraria: string; entrada: string; saida: string;
  sabado: "" | "sim"; sabadoEntrada: string; sabadoSaida: string; sexo: "I" | "F" | "M"; idade: string; idadeAte: string;
  aceitaMedio: "" | "sim" | "nao"; atividades: string; requisitos: string; beneficios: string;
};

function vazio(tipo: TipoVaga): Valores {
  return {
    cargo: "", quantidade: "1", salario: "", cargaHoraria: tipo === "1" ? "30" : "44", entrada: "", saida: "",
    sabado: "", sabadoEntrada: "", sabadoSaida: "", sexo: "I", idade: tipo === "1" ? "16" : "18", idadeAte: "",
    aceitaMedio: "", atividades: "", requisitos: "", beneficios: "",
  };
}

/** As mesmas regras que o servidor e a "Nova vaga" do interno aplicam. */
function conferir(tipo: TipoVaga, v: Valores) {
  const erros: Record<string, string> = {};
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (v.cargo.trim().length < 2) erros.cargo = "Informe o cargo da vaga.";
  const quantidade = Number(v.quantidade);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 20) erros.quantidade = "Use um número de 1 a 20.";
  if (!/^\s*(R\$)?\s*\d[\d.]*(,\d{1,2})?\s*$/.test(v.salario)) erros.salario = "Informe o valor só com números, como 1.500,00.";
  if (!hora.test(v.entrada)) erros.entrada = "Informe a entrada.";
  if (!hora.test(v.saida)) erros.saida = "Informe a saída.";
  if (v.sabado === "sim" && (!hora.test(v.sabadoEntrada) || !hora.test(v.sabadoSaida))) erros.sabado = "Informe a entrada e a saída do sábado.";
  const idade = Number(v.idade);
  const ate = Number(v.idadeAte);
  if (!Number.isInteger(idade) || idade < 14 || idade > 80) erros.idade = "Idade de 14 a 80.";
  if (!v.idadeAte || !Number.isInteger(ate) || ate < 14 || ate > 80) erros.idadeAte = "Idade de 14 a 80.";
  else if (Number.isInteger(idade) && ate < idade) erros.idadeAte = "Menor que a idade inicial.";
  if (tipo === "1" && !v.aceitaMedio) erros.aceitaMedio = "Escolha se a vaga aceita estudante do ensino médio.";
  if (v.atividades.trim().length < 3) erros.atividades = "Descreva o que a pessoa vai fazer.";
  if (v.requisitos.trim().length < 3) erros.requisitos = "Diga o que a pessoa precisa ter ou saber.";
  return erros;
}

export function VagaNova({ tipo: tipoInicial, tipos }: { tipo: string; tipos: TipoVaga[] }) {
  const liberados: TipoVaga[] = tipos.length ? tipos : [tipoInicial === "1" ? "1" : "2"];
  const [tipo, setTipo] = useState<TipoVaga>(liberados.includes(tipoInicial as TipoVaga) ? tipoInicial as TipoVaga : liberados[0]);
  const [valores, setValores] = useState<Valores>(() => vazio(liberados.includes(tipoInicial as TipoVaga) ? tipoInicial as TipoVaga : liberados[0]));
  const [erro, setErro] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [criada, setCriada] = useState<{ id: string; cargo: string; codigo: string | null } | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const info = TIPOS[tipo];
  const definir = <K extends keyof Valores>(campo: K, valor: Valores[K]) => {
    setValores((atual) => ({ ...atual, [campo]: valor }));
    if (campos[campo]) setCampos((atual) => ({ ...atual, [campo]: "" }));
  };
  const mudar = (campo: keyof Valores) => (event: { target: { value: string } }) => definir(campo, event.target.value as never);
  const trocarTipo = (novo: TipoVaga) => {
    if (novo === tipo) return;
    setTipo(novo);
    setValores((atual) => ({ ...atual, cargaHoraria: novo === "1" ? "30" : "44", idade: atual.idade === (tipo === "1" ? "16" : "18") ? (novo === "1" ? "16" : "18") : atual.idade, aceitaMedio: "" }));
    setCampos({});
  };
  const salvar = useMutation({
    mutationFn: () => api<{ id: string; codigo: string | null }>("/api/v1/empresa/vagas", { method: "POST", body: JSON.stringify({ tipo, ...valores }) }),
    onSuccess: async (resposta) => {
      await client.invalidateQueries();
      setCriada({ id: resposta.data.id, cargo: valores.cargo.trim(), codigo: resposta.data.codigo });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.message : "Não foi possível abrir a vaga. Tente de novo em instantes.");
      if (error instanceof ApiError && error.campos) setCampos(error.campos);
    },
  });
  const quantidade = Number(valores.quantidade);
  const horario = valores.entrada && valores.saida
    ? `Seg a sex, ${valores.entrada} às ${valores.saida}${valores.sabado === "sim" && valores.sabadoEntrada && valores.sabadoSaida ? `; sáb, ${valores.sabadoEntrada} às ${valores.sabadoSaida}` : ""}`
    : "";
  const resumo: Array<[string, string]> = [
    ["Modalidade", info.nome],
    ...(tipo === "1" ? [["Ensino médio", valores.aceitaMedio === "sim" ? "Aceita" : valores.aceitaMedio === "nao" ? "Não aceita" : ""] as [string, string]] : []),
    ["Cargo", valores.cargo.trim()],
    ["Posições", Number.isInteger(quantidade) && quantidade > 0 ? String(quantidade) : ""],
    [info.salario, valores.salario.trim() ? dinheiro(valores.salario) : ""],
    ["Carga", `${valores.cargaHoraria}h por semana`],
    ["Horário", horario],
    ["Idade", valores.idade && valores.idadeAte ? `${valores.idade} a ${valores.idadeAte} anos` : ""],
  ];
  const faltando = Object.keys(conferir(tipo, valores)).length;

  if (criada) {
    return (
      <Card className="mx-auto grid w-full max-w-xl justify-items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check size={28} /></span>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Vaga aberta</h1>
        <p className="max-w-sm text-sm text-slate-500">
          <strong className="text-ink">{criada.cargo}</strong>{criada.codigo ? <> (código <strong className="text-ink">{criada.codigo}</strong>)</> : null} já está em Vagas, na situação Em aberto. A equipe da DNA Work recebe a vaga para começar a seleção.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link to={`/vagas/${criada.id}`} className={botao("primary", "botao")}>Ver a vaga</Link>
          <Link to="/vagas" className={botao("secondary", "botao")}>Vagas em aberto</Link>
          <Button variant="ghost" onClick={() => { setCriada(null); setValores(vazio(tipo)); setErro(""); setCampos({}); }}><Plus size={16} /> Abrir outra</Button>
        </div>
      </Card>
    );
  }

  return (
    <form className="grid grid-cols-[minmax(0,1fr)] gap-5" noValidate onSubmit={(event) => {
      event.preventDefault();
      setErro("");
      const erros = conferir(tipo, valores);
      setCampos(erros);
      if (Object.keys(erros).length) {
        setErro(Object.keys(erros).length > 1 ? "Confira os campos marcados em vermelho." : Object.values(erros)[0]);
        return;
      }
      salvar.mutate();
    }}>
      <Link to="/vagas" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Vagas</Link>
      <CabecalhoPagina titulo="Abrir vaga" descricao="Preencha os blocos abaixo. A vaga entra direto no sistema da DNA Work, que começa a seleção." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Bloco numero={1} titulo="Modalidade" texto={tipo === "1" ? "Tipo de contratação e quem pode se candidatar." : "Escolha o tipo de contratação."} feito={tipo !== "1" || Boolean(valores.aceitaMedio)}>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Modalidade">
              {liberados.map((id) => {
                const opcao = TIPOS[id];
                const ativo = id === tipo;
                return (
                  <button key={id} type="button" role="radio" aria-checked={ativo} onClick={() => trocarTipo(id)}
                    className={cn("flex items-start gap-3 rounded-xl border p-3.5 text-left transition", ativo ? "border-violet-600 bg-violet-50 ring-2 ring-violet-600/20" : "border-slate-200 bg-white hover:border-violet-300")}>
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", ativo ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-600")}><opcao.icone size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-ink">{opcao.nome}</span>
                      <span className="block text-xs text-slate-500">{opcao.texto}</span>
                    </span>
                    {ativo ? <Check size={18} className="shrink-0 text-violet-700" /> : null}
                  </button>
                );
              })}
            </div>
            {tipo === "1" ? (
              <div className={cn("grid gap-2 rounded-xl p-3.5", campos.aceitaMedio ? "bg-rose-50 ring-1 ring-rose-200" : "bg-slate-50")}>
                <p className="text-sm font-semibold text-ink">Aceita estudante do ensino médio?</p>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Aceita estudante do ensino médio">
                  {([["sim", "Sim, aceita", "Ensino médio, técnico ou superior."], ["nao", "Não aceita", "Só técnico ou superior."]] as const).map(([valor, rotulo, texto]) => {
                    const ativo = valores.aceitaMedio === valor;
                    return (
                      <button key={valor} type="button" role="radio" aria-checked={ativo} onClick={() => definir("aceitaMedio", valor)}
                        className={cn("flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-left transition", ativo ? "border-violet-600 ring-2 ring-violet-600/20" : "border-slate-200 hover:border-violet-300")}>
                        <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", ativo ? "border-violet-700 bg-violet-700 text-white" : "border-slate-300")}>{ativo ? <Check size={12} /> : null}</span>
                        <span>
                          <span className="block text-sm font-semibold text-ink">{rotulo}</span>
                          <span className="block text-xs text-slate-500">{texto}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {campos.aceitaMedio ? <p className="text-xs text-rose-600">{campos.aceitaMedio}</p> : null}
              </div>
            ) : null}
          </Bloco>

          <Bloco numero={2} titulo="Sobre a vaga" texto="Cargo, quantas pessoas e quanto a vaga paga." feito={valores.cargo.trim().length >= 2 && Boolean(valores.salario.trim())}>
            <div className="grid gap-3 sm:grid-cols-6">
              <Field className="sm:col-span-4" label="Cargo" erro={campos.cargo}>
                <Input autoFocus maxLength={180} placeholder={tipo === "1" ? "Ex.: Estagiário administrativo" : "Ex.: Auxiliar administrativo"} value={valores.cargo} onChange={mudar("cargo")} aria-invalid={Boolean(campos.cargo)} />
              </Field>
              <Field className="sm:col-span-2" label="Posições" erro={campos.quantidade}>
                <Input type="number" inputMode="numeric" min={1} max={20} value={valores.quantidade} onChange={mudar("quantidade")} aria-invalid={Boolean(campos.quantidade)} />
              </Field>
              <Field className="sm:col-span-3" label={`${info.salario} (R$)`} erro={campos.salario}>
                <Input inputMode="decimal" maxLength={40} placeholder="Ex.: 1.500,00" value={valores.salario} onChange={mudar("salario")} aria-invalid={Boolean(campos.salario)} />
              </Field>
            </div>
          </Bloco>

          <Bloco numero={3} titulo="Jornada" texto="Carga por semana e o horário de segunda a sexta." feito={Boolean(valores.entrada && valores.saida)}>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="grid content-start gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-slate-700">Carga semanal</span>
                <FiltroChips rotulo="Carga semanal" valor={valores.cargaHoraria} onChange={(valor) => definir("cargaHoraria", valor)}
                  opcoes={(tipo === "1" ? ["20", "30"] : ["40", "44"]).map((horas) => ({ id: horas, rotulo: `${horas}h` }))} />
              </div>
              <Field className="sm:col-span-2" label="Entrada" erro={campos.entrada}>
                <Input type="time" value={valores.entrada} onChange={mudar("entrada")} aria-invalid={Boolean(campos.entrada)} />
              </Field>
              <Field className="sm:col-span-2" label="Saída" erro={campos.saida}>
                <Input type="time" value={valores.saida} onChange={mudar("saida")} aria-invalid={Boolean(campos.saida)} />
              </Field>
            </div>
            <label className="flex w-fit items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={valores.sabado === "sim"} onChange={(event) => definir("sabado", event.target.checked ? "sim" : "")} />
              Também trabalha aos sábados
            </label>
            {valores.sabado === "sim" ? (
              <div className="grid gap-3 sm:grid-cols-6">
                <Field className="sm:col-span-2" label="Entrada no sábado"><Input type="time" value={valores.sabadoEntrada} onChange={mudar("sabadoEntrada")} /></Field>
                <Field className="sm:col-span-2" label="Saída no sábado" erro={campos.sabado}><Input type="time" value={valores.sabadoSaida} onChange={mudar("sabadoSaida")} /></Field>
              </div>
            ) : null}
          </Bloco>

          <Bloco numero={4} titulo="Perfil do candidato" texto="Faixa de idade e sexo aceitos." feito={Boolean(valores.idade && valores.idadeAte)}>
            <div className="grid gap-3 sm:grid-cols-6">
              <Field className="sm:col-span-2" label="Idade de" erro={campos.idade}>
                <Input type="number" inputMode="numeric" min={14} max={80} value={valores.idade} onChange={mudar("idade")} aria-invalid={Boolean(campos.idade)} />
              </Field>
              <Field className="sm:col-span-2" label="Idade até" erro={campos.idadeAte}>
                <Input type="number" inputMode="numeric" min={14} max={80} placeholder={tipo === "1" ? "Ex.: 24" : "Ex.: 45"} value={valores.idadeAte} onChange={mudar("idadeAte")} aria-invalid={Boolean(campos.idadeAte)} />
              </Field>
              <Field className="sm:col-span-2" label="Sexo">
                <Select value={valores.sexo} onChange={mudar("sexo")}>
                  <option value="I">Indiferente</option>
                  <option value="F">Feminino</option>
                  <option value="M">Masculino</option>
                </Select>
              </Field>
            </div>
          </Bloco>

          <Bloco numero={5} titulo="Atividades e requisitos" texto="O que a pessoa vai fazer, o que precisa ter e o que a vaga oferece." feito={valores.atividades.trim().length >= 3 && valores.requisitos.trim().length >= 3}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Atividades" erro={campos.atividades}>
                <Textarea maxLength={4000} placeholder="Ex.: Atendimento ao cliente, organização de documentos…" value={valores.atividades} onChange={mudar("atividades")} aria-invalid={Boolean(campos.atividades)} />
              </Field>
              <Field label="Requisitos" erro={campos.requisitos}>
                <Textarea maxLength={4000} placeholder={tipo === "1" ? "Ex.: Cursando Administração a partir do 2º semestre" : "Ex.: Ensino médio completo, experiência com Excel"} value={valores.requisitos} onChange={mudar("requisitos")} aria-invalid={Boolean(campos.requisitos)} />
              </Field>
              <Field className="sm:col-span-2" label="Benefícios" dica="opcional">
                <Textarea className="min-h-20" maxLength={4000} placeholder="Um por linha. Ex.: Vale-transporte" value={valores.beneficios} onChange={mudar("beneficios")} />
              </Field>
            </div>
          </Bloco>
        </div>

        <aside className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(28_21_36/0.05)] xl:sticky xl:top-20">
          <div>
            <p className="text-[15px] font-bold text-ink">Resumo da vaga</p>
            <p className="text-sm text-slate-500">Confira antes de abrir.</p>
          </div>
          <dl className="grid gap-2 text-sm">
            {resumo.map(([rotulo, valor]) => (
              <div key={rotulo} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0">
                <dt className="shrink-0 text-slate-500">{rotulo}</dt>
                <dd className={cn("min-w-0 truncate text-right font-semibold", valor ? "text-ink" : "text-slate-300")} title={valor}>{valor || "—"}</dd>
              </div>
            ))}
          </dl>
          {erro ? <Alerta>{erro}</Alerta> : null}
          <Button type="submit" className="h-11 w-full" disabled={salvar.isPending}>
            <Briefcase size={16} /> {salvar.isPending ? "Abrindo vaga…" : "Abrir vaga"}
          </Button>
          {faltando ? <p className="text-xs text-slate-500">{faltando === 1 ? "Falta 1 campo" : `Faltam ${faltando} campos`} para abrir a vaga.</p> : <p className="text-xs text-emerald-700">Tudo pronto para abrir.</p>}
          <button type="button" className="text-sm font-semibold text-slate-500 hover:text-ink" onClick={() => navigate("/vagas")}>Cancelar</button>
        </aside>
      </div>
    </form>
  );
}
