import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../lib/api";
import { Alerta, Button, CabecalhoPagina, Card, Field, Input } from "../components/ui";

/** Troca de senha por conta própria: pede a atual, a nova e a confirmação. */
export function AlterarSenhaPage() {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [salva, setSalva] = useState(false);
  const client = useQueryClient();
  const salvar = useMutation({
    mutationFn: () => api("/api/v1/empresa/senha", { method: "POST", body: JSON.stringify({ senhaAtual: atual, password: nova }) }),
    onSuccess: async () => {
      setAtual("");
      setNova("");
      setConfirma("");
      setSalva(true);
      await client.invalidateQueries({ queryKey: ["sessao-empresa"] });
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
    if (nova.length < 6) locais.password = "Use pelo menos 6 caracteres.";
    else if (nova !== confirma) locais.confirma = "As senhas não conferem.";
    setCampos(locais);
    if (!Object.keys(locais).length) salvar.mutate();
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo="Alterar senha" descricao="Troque a senha com que você entra no portal. Depois da troca, use a nova no próximo login." />
      <Card className="max-w-md md:p-5">
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); enviar(); }}>
          <Field label="Senha atual" erro={campos.senhaAtual}>
            <Input type="password" autoComplete="current-password" required value={atual} onChange={(event) => setAtual(event.target.value)} />
          </Field>
          <Field label="Nova senha" dica="pelo menos 6 caracteres" erro={campos.password}>
            <Input type="password" autoComplete="new-password" minLength={6} required value={nova} onChange={(event) => setNova(event.target.value)} />
          </Field>
          <Field label="Repita a nova senha" erro={campos.confirma}>
            <Input type="password" autoComplete="new-password" minLength={6} required value={confirma} onChange={(event) => setConfirma(event.target.value)} />
          </Field>
          {erro ? <Alerta>{erro}</Alerta> : null}
          {salva ? <Alerta tom="ok">Senha alterada.</Alerta> : null}
          <div>
            <Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar senha"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
