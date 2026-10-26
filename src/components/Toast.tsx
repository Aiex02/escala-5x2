import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from "lucide-react";

type TipoToast = "sucesso" | "erro" | "info";

interface ItemToast {
  id: number;
  tipo: TipoToast;
  texto: string;
}

interface Notificador {
  sucesso(texto: string): void;
  erro(texto: string): void;
  info(texto: string): void;
}

const ContextoToast = createContext<Notificador | null>(null);

const ICONES: Record<TipoToast, LucideIcon> = { sucesso: CircleCheck, erro: CircleAlert, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemToast[]>([]);
  const sequencia = useRef(0);

  const remover = useCallback((id: number) => setItens((lista) => lista.filter((i) => i.id !== id)), []);

  const adicionar = useCallback(
    (tipo: TipoToast, texto: string) => {
      const id = ++sequencia.current;
      setItens((lista) => [...lista.slice(-3), { id, tipo, texto }]);
      window.setTimeout(() => remover(id), tipo === "erro" ? 9000 : 5000);
    },
    [remover],
  );

  const notificador = useMemo<Notificador>(
    () => ({
      sucesso: (texto) => adicionar("sucesso", texto),
      erro: (texto) => adicionar("erro", texto),
      info: (texto) => adicionar("info", texto),
    }),
    [adicionar],
  );

  return (
    <ContextoToast.Provider value={notificador}>
      {children}
      <div className="toasts" role="region" aria-label="Notificações" aria-live="polite">
        {itens.map((item) => {
          const Icone = ICONES[item.tipo];
          return (
            <div key={item.id} className={`toast toast-${item.tipo}`} role={item.tipo === "erro" ? "alert" : "status"}>
              <Icone className="toast-icone" size={18} strokeWidth={1.9} aria-hidden="true" />
              <span className="toast-texto">{item.texto}</span>
              <button type="button" className="toast-fechar" aria-label="Fechar notificação" onClick={() => remover(item.id)}>
                <X size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ContextoToast.Provider>
  );
}

export function useNotificar(): Notificador {
  const contexto = useContext(ContextoToast);
  if (!contexto) throw new Error("useNotificar precisa estar dentro de <ToastProvider>.");
  return contexto;
}
