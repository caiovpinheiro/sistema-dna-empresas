import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type PermissaoPonto = "ver" | "solicitacoes" | "cadastro" | "empresa";
export type AcessoSessao = { limitado: boolean; permissoes: PermissaoPonto[] };

/**
 * O que o usuário do portal pode fazer no ponto (vem da sessão). Serve só para esconder botões: quem decide de verdade é
 * o servidor, que recusa o que a pessoa não pode.
 */
export function useAcesso() {
  const sessao = useQuery({
    queryKey: ["sessao-empresa"],
    queryFn: () => api<{ acesso?: AcessoSessao }>("/api/v1/empresa/sessao"),
  });
  const acesso = sessao.data?.data.acesso;
  return {
    limitado: Boolean(acesso?.limitado),
    pode: (permissao: PermissaoPonto) => !acesso?.limitado || acesso.permissoes.includes(permissao),
  };
}
