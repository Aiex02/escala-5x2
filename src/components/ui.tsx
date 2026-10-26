import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, RotateCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { Botao } from "./base/Botao";

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="carregando" role="status">
      <span className="giro" aria-hidden="true" />
      {texto}
    </div>
  );
}

interface EstadoVazioProps {
  titulo: string;
  icone?: LucideIcon;
  children?: ReactNode;
  acao?: ReactNode;
}

export function EstadoVazio({ titulo, icone: Icone, children, acao }: EstadoVazioProps) {
  return (
    <div className="estado-vazio">
      {Icone && (
        <span className="estado-vazio-icone" aria-hidden="true">
          <Icone size={26} strokeWidth={1.6} />
        </span>
      )}
      <h2>{titulo}</h2>
      {children && <div className="estado-vazio-texto">{children}</div>}
      {acao && <div className="estado-vazio-acao">{acao}</div>}
    </div>
  );
}

type TipoAlerta = "erro" | "info" | "sucesso" | "atencao";

const ICONES_ALERTA: Record<TipoAlerta, LucideIcon> = {
  erro: CircleAlert,
  info: Info,
  sucesso: CircleCheck,
  atencao: TriangleAlert,
};

interface AlertaProps {
  tipo?: TipoAlerta;
  children: ReactNode;
  acao?: ReactNode;
}

export function Alerta({ tipo = "info", children, acao }: AlertaProps) {
  const Icone = ICONES_ALERTA[tipo];
  return (
    <div className={`alerta alerta-${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      <Icone className="alerta-icone" size={18} strokeWidth={1.9} aria-hidden="true" />
      <div className="alerta-texto">{children}</div>
      {acao && <div className="alerta-acao">{acao}</div>}
    </div>
  );
}

export function ErroCarregamento({ mensagem, onTentarNovamente }: { mensagem: string; onTentarNovamente: () => void }) {
  return (
    <div className="tela">
      <Alerta
        tipo="erro"
        acao={
          <Botao tamanho="p" icone={RotateCw} onClick={onTentarNovamente}>
            Tentar de novo
          </Botao>
        }
      >
        Não foi possível carregar os dados. {mensagem}
      </Alerta>
    </div>
  );
}

type TomSelo = "neutro" | "sucesso" | "atencao" | "perigo" | "destaque";

/** Etiqueta curta de status ou contagem. */
export function Selo({ tom = "neutro", children, dica }: { tom?: TomSelo; children: ReactNode; dica?: string }) {
  return (
    <span className={`selo selo-${tom}`} data-dica={dica} tabIndex={dica ? 0 : undefined}>
      {children}
    </span>
  );
}

/** Cabeçalho de tela: título condensado à esquerda, ações à direita. */
export function CabecalhoTela({ titulo, children, acoes }: { titulo: ReactNode; children?: ReactNode; acoes?: ReactNode }) {
  return (
    <header className="tela-cab">
      <div className="tela-titulos">
        <h1>{titulo}</h1>
        {children && <div className="tela-sub">{children}</div>}
      </div>
      {acoes && <div className="tela-acoes">{acoes}</div>}
    </header>
  );
}
