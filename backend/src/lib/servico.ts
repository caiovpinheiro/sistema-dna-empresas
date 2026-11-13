export async function pingServico(baseUrl: string, token: string): Promise<{ ok: boolean; servico?: string }> {
  if (!baseUrl || !token) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/servico/ping`, {
      headers: { "x-service-token": token },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    const body = await response.json() as { data?: { servico?: string } };
    return { ok: true, servico: body.data?.servico };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export function tokenDoServico(header: string | string[] | undefined, esperado: string): boolean {
  if (!esperado) return false;
  const recebido = Array.isArray(header) ? header[0] : header;
  return recebido === esperado;
}

export type RespostaServico = { status: number; body: { success?: boolean; data?: unknown; error?: { code?: string; message?: string } } | null };

/** POST para o outro sistema com o token de serviço. Falha de rede volta status 0. */
export async function postServico(baseUrl: string, token: string, caminho: string, corpo: unknown, tempoMs = 30000): Promise<RespostaServico> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tempoMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${caminho}`, {
      method: "POST",
      headers: { "x-service-token": token, "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as RespostaServico["body"];
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
