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

export async function api<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => null) as Envelope<T> & { error?: { code: string; message: string; campos?: Record<string, string> } } | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(response.status, body?.error?.code ?? "ERRO", body?.error?.message ?? "Não foi possível concluir a operação.", body?.error?.campos);
  }
  return body;
}
