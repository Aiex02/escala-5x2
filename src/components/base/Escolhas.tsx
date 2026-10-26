// Controles de escolha: dias da semana, cor e alternância segmentada.

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, type LucideIcon } from "lucide-react";
import { DIAS_SEMANA_CURTO, DIAS_SEMANA_LONGO } from "../../util/datas";
import { corHexValida } from "../../util/formato";
import { Entrada } from "./Campo";
import { useCliqueFora, useFlutuante } from "./flutuante";

const SEG_SEX = [0, 1, 2, 3, 4];
const SEG_SAB = [0, 1, 2, 3, 4, 5];
const TODOS = [0, 1, 2, 3, 4, 5, 6];

const iguais = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** "Seg a sex", "Seg a sáb", "Todos os dias", "Seg, qua e sex"... */
export function resumoDias(dias: number[]): string {
  const d = [...dias].sort((a, b) => a - b);
  if (d.length === 0) return "Nenhum dia";
  if (iguais(d, TODOS)) return "Todos os dias";
  if (iguais(d, SEG_SEX)) return "Seg a sex";
  if (iguais(d, SEG_SAB)) return "Seg a sáb";
  const nomes = d.map((i) => (DIAS_SEMANA_CURTO[i] ?? "").toLowerCase());
  const texto = nomes.length === 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

interface SeletorDiasProps {
  valor: number[];
  onMudar: (dias: number[]) => void;
  idRotulo?: string;
}

/** Sete botões liga/desliga (Seg…Dom) e atalhos para as combinações comuns. */
export function SeletorDias({ valor, onMudar, idRotulo }: SeletorDiasProps) {
  const ordenado = [...valor].sort((a, b) => a - b);
  function alternar(dia: number) {
    const novo = ordenado.includes(dia) ? ordenado.filter((d) => d !== dia) : [...ordenado, dia].sort((a, b) => a - b);
    onMudar(novo);
  }
  const atalhos: [string, number[]][] = [
    ["Seg a sex", SEG_SEX],
    ["Seg a sáb", SEG_SAB],
    ["Todos os dias", TODOS],
  ];
  return (
    <div className="seletor-dias">
      <div className="dias-botoes" role="group" aria-labelledby={idRotulo}>
        {DIAS_SEMANA_CURTO.map((nome, i) => (
          <button
            key={nome}
            type="button"
            className="dia-botao"
            aria-pressed={ordenado.includes(i)}
            aria-label={DIAS_SEMANA_LONGO[i]}
            onClick={() => alternar(i)}
          >
            {nome}
          </button>
        ))}
      </div>
      <div className="dias-atalhos">
        {atalhos.map(([rotulo, dias]) => (
          <button key={rotulo} type="button" className="atalho" aria-pressed={iguais(ordenado, dias)} onClick={() => onMudar(dias)}>
            {rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sete letras com os dias ativos destacados (somente leitura). */
export function DiasCompactos({ dias, rotulo }: { dias: number[]; rotulo: string }) {
  return (
    <span className="dias-compactos" role="img" aria-label={`${rotulo}: ${resumoDias(dias)}`} data-dica={resumoDias(dias)}>
      {["S", "T", "Q", "Q", "S", "S", "D"].map((letra, i) => (
        <span key={i} className={dias.includes(i) ? "dia-letra ativo" : "dia-letra"}>
          {letra}
        </span>
      ))}
    </span>
  );
}

export const PALETA_TURNOS = [
  "#F2B705",
  "#F2780C",
  "#E0533D",
  "#D63A7A",
  "#8E4DC4",
  "#3B5BDB",
  "#1F8FD6",
  "#0F9E9A",
  "#2E9E5B",
  "#7A9A1F",
  "#8A6A4F",
  "#64748B",
];

interface SeletorCorProps {
  id: string;
  valor: string;
  onMudar: (cor: string) => void;
}

/** Amostra de cor que abre uma paleta + campo hexadecimal (o seletor nativo varia por sistema). */
export function SeletorCor({ id, valor, onMudar }: SeletorCorProps) {
  const gatilho = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [hex, setHex] = useState(valor);
  const estilo = useFlutuante(gatilho, aberto, { largura: 232, alturaMax: 260 });
  const fechar = useCallback(() => setAberto(false), []);
  useCliqueFora([gatilho, painel], aberto, fechar);

  return (
    <>
      <button
        ref={gatilho}
        id={id}
        type="button"
        className="selecao seletor-cor"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => {
          setHex(valor);
          setAberto((a) => !a);
        }}
      >
        <span className="amostra" style={{ "--amostra": corHexValida(valor) ? valor : "#888888" } as CSSProperties} aria-hidden="true" />
        <span className="selecao-valor">{valor.toUpperCase()}</span>
      </button>
      {aberto &&
        createPortal(
          <div
            ref={painel}
            className="flutuante painel-cor"
            style={estilo}
            role="dialog"
            aria-label="Escolher cor"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setAberto(false);
                gatilho.current?.focus();
              }
            }}
          >
            <div className="paleta">
              {PALETA_TURNOS.map((cor) => (
                <button
                  key={cor}
                  type="button"
                  className="paleta-cor"
                  style={{ "--amostra": cor } as CSSProperties}
                  aria-label={cor}
                  aria-pressed={cor.toLowerCase() === valor.toLowerCase()}
                  onClick={() => {
                    onMudar(cor);
                    setAberto(false);
                    gatilho.current?.focus();
                  }}
                >
                  {cor.toLowerCase() === valor.toLowerCase() && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <Entrada
              tamanho="p"
              value={hex}
              aria-label="Cor em hexadecimal"
              invalido={!corHexValida(hex)}
              maxLength={7}
              onChange={(e) => {
                const t = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                setHex(t);
                if (corHexValida(t)) onMudar(t.toUpperCase());
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

interface OpcaoSegmento<T extends string> {
  valor: T;
  rotulo: string;
  icone?: LucideIcon;
}

interface SegmentadoProps<T extends string> {
  valor: T;
  opcoes: OpcaoSegmento<T>[];
  onMudar: (valor: T) => void;
  rotulo: string;
}

/** Alternância entre poucas opções exclusivas (ex.: Mês | Semana). */
export function Segmentado<T extends string>({ valor, opcoes, onMudar, rotulo }: SegmentadoProps<T>) {
  return (
    <div className="segmentado" role="group" aria-label={rotulo}>
      {opcoes.map(({ valor: v, rotulo: r, icone: Icone }) => (
        <button key={v} type="button" aria-pressed={v === valor} onClick={() => onMudar(v)}>
          {Icone && <Icone size={15} strokeWidth={1.9} aria-hidden="true" />}
          {r}
        </button>
      ))}
    </div>
  );
}
