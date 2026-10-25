import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card } from "../components/ui";
import { ApiError, api } from "../lib/api";

type Registro = { id: number; data: string; entrada: string | null; saida: string | null; nsrEntrada: number | null; nsrSaida: number | null };
type Painel = { nome: string; empresa: string; acao: "entrada" | "saida" | "bloqueado"; motivo: string | null; registros: Registro[] };
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
        <form className="relative mt-12 w-full max-w-md rounded-[2rem] bg-white px-8 pb-8 pt-16 shadow-[0_24px_50px_rgb(49_10_80_/_18%)]" onSubmit={(event) => { event.preventDefault(); setErro(""); login.mutate(); }}>
          <span className="absolute left-1/2 top-0 z-10 flex h-24 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-white px-3 shadow-[0_14px_28px_rgb(49_10_80_/_18%)]">
            <img src="/logo-mono.png" alt="DNA Work" className="h-12 w-full object-contain" />
          </span>
          <h1 className="text-center text-xl font-extrabold">Bater ponto</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Use o CPF e a senha do portal do candidato.</p>
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
  const [pin, setPin] = useState("");
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
      body: JSON.stringify({ pin, confirmar: aceite, latitude: local?.latitude, longitude: local?.longitude }),
    }),
    onSuccess: async (resposta) => {
      setErro("");
      setPin("");
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

  if (painel.isLoading) return <div className="grid min-h-screen place-items-center bg-[#f6f3f8] text-sm text-slate-500">Carregando relógio…</div>;
  if (painel.isError || !painel.data) return <PontoLoginPage />;
  const dados = painel.data.data;
  const titulo = dados.acao === "saida" ? "Saída" : "Entrada";

  return (
    <div className="min-h-screen bg-[#f6f3f8] px-4 py-8">
      <div className="mx-auto grid w-full max-w-lg gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#5b21b6]">DNA Work</p>
            <h1 className="text-2xl font-extrabold">{dados.nome}</h1>
            <p className="text-sm text-slate-500">{dados.empresa}</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => sair.mutate()}>Sair</Button>
        </div>
        <Card className="grid justify-items-center gap-4 text-center hover:translate-y-0">
          <p className="text-5xl font-extrabold tabular-nums">{agora}</p>
          {dados.acao === "bloqueado" ? <p className="text-sm font-semibold text-rose-700">{dados.motivo}</p> : (
            <form className="grid w-full max-w-xs gap-3" onSubmit={(event) => { event.preventDefault(); setErro(""); bater.mutate(confirmar); }}>
              <p className="text-sm font-semibold">{titulo}</p>
              <input className="h-12 rounded-full bg-[#eceff3] px-4 text-center text-lg tracking-[0.3em] outline-none focus:ring-4 focus:ring-[#7c3aed]/20" inputMode="numeric" autoComplete="off" required placeholder="PIN" aria-label="PIN" value={pin} onChange={(event) => setPin(event.target.value)} />
              {avisoLocal ? <p className="text-xs text-amber-700">{avisoLocal}</p> : null}
              {confirmar ? <p className="text-sm text-amber-800">A última batida foi há menos de 5 minutos. Envie de novo para confirmar.</p> : null}
              {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
              <Button type="submit" className="h-12 rounded-full" disabled={bater.isPending}>{bater.isPending ? "Registrando…" : confirmar ? "Confirmar batida" : `Registrar ${titulo.toLowerCase()}`}</Button>
            </form>
          )}
        </Card>
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
      </div>
    </div>
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
