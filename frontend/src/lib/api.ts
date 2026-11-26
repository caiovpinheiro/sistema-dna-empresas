export class ApiError extends Error {
  status: number;
  code: string;
  campos?: Record<string, string>;

  constructor(status: number, code: string, message: string, campos?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.campos = campos;
  }
}

export type Envelope<T> = { success: boolean; data: T };

/**
 * Gestão do ponto pelo app do colaborador: as mesmas telas do portal da empresa, mas cada chamada vai para
 * /api/v1/ponto/gestao, onde o servidor só libera o que a empresa deu de permissão a esse colaborador.
 */
let gestaoDoPonto = false;
export function usarGestaoDoPonto() {
  gestaoDoPonto = true;
}

export async function api<T>(caminho: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const path = gestaoDoPonto && caminho.startsWith("/api/v1/empresa/") ? `/api/v1/ponto/gestao/${caminho.slice("/api/v1/empresa/".length)}` : caminho;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => null) as Envelope<T> & { error?: { code: string; message: string; campos?: Record<string, string> } } | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(response.status, body?.error?.code ?? "ERRO", body?.error?.message ?? "Não foi possível concluir a operação.", body?.error?.campos);
  }
  return body;
}
