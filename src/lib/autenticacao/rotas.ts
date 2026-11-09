export const ROTA_LOGIN = "/login";

export type Decisao =
  | { tipo: "seguir" }
  | { tipo: "redirecionar"; destino: string }
  | { tipo: "naoAutorizado" };

/** Decide o que o proxy faz para um caminho dado o estado de autenticação. */
export function decidirAcesso(caminho: string, autenticado: boolean, busca = ""): Decisao {
  if (!autenticado) {
    if (caminho.startsWith("/api/")) return { tipo: "naoAutorizado" };
    if (caminho !== ROTA_LOGIN) {
      const destino =
        caminho === "/" ? ROTA_LOGIN : `${ROTA_LOGIN}?proximo=${encodeURIComponent(caminho + busca)}`;
      return { tipo: "redirecionar", destino };
    }
    return { tipo: "seguir" };
  }
  if (caminho === ROTA_LOGIN) return { tipo: "redirecionar", destino: "/" };
  return { tipo: "seguir" };
}

/** Sanitiza o destino pós-login: só caminhos internos começando com "/" (e não "//"); senão "/". */
export function destinoSeguro(proximo: string | null | undefined): string {
  if (!proximo || !proximo.startsWith("/") || proximo.startsWith("//") || proximo.startsWith("/\\")) return "/";
  return proximo;
}
