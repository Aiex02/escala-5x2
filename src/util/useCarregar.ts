import { useCallback, useEffect, useRef, useState } from "react";
import { mensagemErro } from "../api/client";

interface Estado<T> {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
}

/**
 * Carrega dados assíncronos e refaz a busca quando `deps` muda ou `recarregar()`
 * é chamado. Durante uma recarga os dados anteriores continuam disponíveis.
 */
export function useCarregar<T>(buscar: () => Promise<T>, deps: readonly unknown[]) {
  const [estado, setEstado] = useState<Estado<T>>({ dados: null, carregando: true, erro: null });
  const [tentativa, setTentativa] = useState(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  useEffect(() => {
    let cancelado = false;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    buscarRef
      .current()
      .then((dados) => {
        if (!cancelado) setEstado({ dados, carregando: false, erro: null });
      })
      .catch((e: unknown) => {
        if (!cancelado) setEstado((s) => ({ dados: s.dados, carregando: false, erro: mensagemErro(e) }));
      });
    return () => {
      cancelado = true;
    };
  }, [...deps, tentativa]);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);
  const definirDados = useCallback(
    (atualizar: (atual: T) => T) =>
      setEstado((e) => (e.dados === null ? e : { ...e, dados: atualizar(e.dados) })),
    [],
  );

  return { ...estado, recarregar, definirDados };
}
