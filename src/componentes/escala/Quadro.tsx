"use client";

import { memo, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Ban, CalendarCheck, CalendarOff, Check, CircleSlash, Minus, TriangleAlert, UserRoundX, X } from "lucide-react";
import { toast } from "sonner";
import { nomeDiaCurto } from "@/lib/datas";
import { formatarMinutos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/componentes/ui/popover";
import { formatarHora } from "@/motor";
import type { AgendaMesDto, CelulaDto, DiaDto, LacunaDto, LinhaFuncionarioDto, TurnoAgendaDto, ValorDia } from "@/servicos/agendaDto";
import { celulaTrocavel, classeSaldo, descreverCelula, temHoraExtra, estiloTurno, faixaHorario, formatarDiaMesBR, NOMES_DIA_LONGO, textoSaldo } from "./util";

export type FocoSolicitado = { funcionarioId: string | null; data: string; nonce: number };

type Props = {
  agenda: AgendaMesDto;
  hoje: string;
  focoSolicitado: FocoSolicitado | null;
  aoEditar: (funcionarioId: string, data: string, valor: ValorDia) => void;
  /** Troca o que duas pessoas têm no mesmo dia. */
  aoTrocar: (data: string, funcionarioA: string, funcionarioB: string) => void;
  aoFecharDia: (data: string, motivo: string) => void;
  aoReabrirDia: (data: string) => void;
};

const CEL = "h-[38px] w-[38px] shrink-0 p-px";
const COL_NOME = "w-48 shrink-0";
const COL_STATS = "w-16 shrink-0";

const HACHURA = (cor: string): string => `repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklch, ${cor} 22%, transparent) 4px 5px)`;

function classeFundoDia(dia: DiaDto, hoje: string): string {
  if (dia.fechado) return "bg-texto/[0.08]";
  if (dia.data === hoje) return "bg-acento/10";
  if (dia.diaSemana >= 5) return "bg-texto/[0.045]";
  return "";
}

type PropsLinha = {
  linha: LinhaFuncionarioDto;
  r: number;
  dias: DiaDto[];
  turnos: ReadonlyMap<string, TurnoAgendaDto>;
  /** Coluna com o foco (só na linha que o tem). */
  focoD: number | null;
  hoje: string;
  comExtras: boolean;
  /** Coluna do dia em troca (null = fora do modo troca). */
  colTroca: number | null;
  /** Esta linha é a pessoa que iniciou a troca. */
  origemTroca: boolean;
};

const LinhaQuadro = memo(function LinhaQuadro({ linha, r, dias, turnos, focoD, hoje, comExtras, colTroca, origemTroca }: PropsLinha) {
  return (
    <div role="row" aria-rowindex={r + 2} className="flex border-b border-borda/60 hover:bg-texto/[0.03]">
      <div role="rowheader" className={cn(COL_NOME, "sticky left-0 z-10 flex items-center gap-1.5 border-r border-borda bg-fundo px-2 text-sm")}>
        <span className="truncate" title={linha.nome}>
          {linha.nome}
        </span>
        {!linha.ativo && <span className="shrink-0 text-[10px] text-texto-suave">inativo</span>}
      </div>
      {dias.map((dia, d) => {
        const c = linha.celulas[d] as CelulaDto;
        const dica = c.tipo === "fechado" && dia.fechado ? `Dia fechado${dia.fechadoMotivo ? `: ${dia.fechadoMotivo}` : ""}` : descreverCelula(c, turnos);
        const rotulo = `${linha.nome}, ${NOMES_DIA_LONGO[dia.diaSemana]} ${formatarDiaMesBR(dia.data)}: ${dica}`;
        const emTroca = colTroca !== null;
        const colunaTroca = emTroca && d === colTroca;
        const desabilitada = emTroca && (!colunaTroca || (!origemTroca && !celulaTrocavel(c)));
        const turno = c.tipo === "turno" ? turnos.get(c.turnoId) : undefined;
        return (
          <div key={dia.data} role="presentation" className={cn(CEL, classeFundoDia(dia, hoje), colunaTroca && "bg-acento/15")}>
            <div
              role="gridcell"
              aria-disabled={desabilitada || undefined}
              tabIndex={focoD === d ? 0 : -1}
              data-r={r}
              data-d={d}
              aria-label={rotulo}
              title={dica}
              style={{
                scrollMarginInline: "13rem",
                scrollMarginTop: "3rem",
                ...(turno ? estiloTurno(turno.cor) : undefined),
                ...(c.tipo === "fechado" ? { backgroundImage: HACHURA("var(--texto)") } : undefined),
                ...(c.tipo === "falta" ? { backgroundImage: HACHURA("var(--critico)") } : undefined),
              }}
              className={cn(
                "relative grid size-full cursor-pointer place-items-center rounded-md border font-mono text-xs outline-none select-none focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-1 focus-visible:ring-offset-fundo",
                c.tipo === "turno" && "font-semibold",
                c.tipo === "folga" && "border-dashed border-borda text-texto-suave/60",
                c.tipo === "falta" && "border-critico/50 bg-critico/10 font-semibold text-critico",
                c.tipo === "justificada" && "border-atencao/50 bg-atencao/15 font-semibold text-[color-mix(in_oklch,var(--atencao),var(--texto)_45%)]",
                c.tipo === "fechado" && "border-borda/40",
                desabilitada && "cursor-not-allowed opacity-35",
                colunaTroca && origemTroca && "ring-2 ring-acento",
              )}
            >
              {c.tipo === "turno" && (turno?.sigla ?? "?")}
              {c.tipo === "folga" && "F"}
              {c.tipo === "falta" && "A"}
              {c.tipo === "justificada" && "J"}
              {c.tipo === "turno" && c.compensada && <span className="absolute right-[3px] bottom-[3px] size-1.5 rounded-full bg-current" aria-hidden />}
              {c.tipo === "turno" && c.origem === "horaExtra" && (
                <>
                  <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-atencao" aria-hidden />
                  <span className="absolute top-[1px] left-[3px] font-mono text-[11px] leading-none font-bold text-atencao" aria-hidden>
                    +
                  </span>
                </>
              )}
              {c.ajustada && <span className="absolute top-0 right-0 border-t-[9px] border-l-[9px] border-t-acento border-l-transparent" aria-hidden />}
            </div>
          </div>
        );
      })}
      <div className="sticky right-0 z-10 flex border-l border-borda bg-fundo font-mono text-xs">
        <div className={cn(COL_STATS, "flex items-center justify-end px-2")}>{formatarMinutos(linha.horasMesMin)}</div>
        <div className={cn(COL_STATS, "flex items-center justify-end px-2", classeSaldo(linha.saldoMesMin))}>{textoSaldo(linha.saldoMesMin)}</div>
        <div className={cn(COL_STATS, "flex items-center justify-end px-2", classeSaldo(linha.acumuladoMin))}>{textoSaldo(linha.acumuladoMin)}</div>
        {comExtras && (
          <div
            title={linha.horaExtraMesMin > 0 ? `Hora extra no mês: ${formatarMinutos(linha.horaExtraMesMin)} · compensa nos meses seguintes` : undefined}
            className={cn(COL_STATS, "flex items-center justify-end px-2", linha.horaExtraMesMin > 0 ? "text-atencao" : "text-texto-suave")}
          >
            {linha.horaExtraMesMin > 0 ? `+${formatarMinutos(linha.horaExtraMesMin)}` : "–"}
          </div>
        )}
      </div>
    </div>
  );
});

type EstadoPopover = { r: number; d: number; modo: "menu" | "motivo" };

export function Quadro({ agenda, hoje, focoSolicitado, aoEditar, aoTrocar, aoFecharDia, aoReabrirDia }: Props) {
  const grade = useRef<HTMLDivElement>(null);
  const ancora = useRef<HTMLElement | null>(null);
  const [foco, setFoco] = useState<{ r: number; d: number }>({ r: 0, d: 0 });
  const [aberto, setAberto] = useState<EstadoPopover | null>(null);
  const [motivo, setMotivo] = useState("");
  const [troca, setTroca] = useState<{ r: number; d: number } | null>(null);
  const [diaMenu, setDiaMenu] = useState<number | null>(null);
  const [motivoDia, setMotivoDia] = useState("");
  const ancoraDia = useRef<HTMLElement | null>(null);
  const buffer = useRef({ texto: "", prazo: 0 });
  const ultimoNonce = useRef<number | null>(null);

  const turnosPorId = useMemo(() => new Map(agenda.turnos.map((t) => [t.id, t])), [agenda.turnos]);
  const turnosAtivos = useMemo(() => agenda.turnos.filter((t) => !t.arquivado), [agenda.turnos]);
  const linhas = useMemo(() => agenda.grupos.flatMap((g) => g.linhas), [agenda.grupos]);
  const inicioDoGrupo = useMemo(() => agenda.grupos.map((_, i) => agenda.grupos.slice(0, i).reduce((soma, g) => soma + g.linhas.length, 0)), [agenda.grupos]);
  const lacunasPorTurnoDia = useMemo(() => {
    const mapa = new Map<string, LacunaDto[]>();
    for (const l of agenda.lacunas) {
      const chave = `${l.turnoId}|${l.data}`;
      const lista = mapa.get(chave) ?? [];
      lista.push(l);
      mapa.set(chave, lista);
    }
    return mapa;
  }, [agenda.lacunas]);

  const focar = useCallback(
    (r: number, d: number) => {
      const rr = Math.max(0, Math.min(linhas.length - 1, r));
      const dd = Math.max(0, Math.min(agenda.dias.length - 1, d));
      const el = grade.current?.querySelector<HTMLElement>(`[data-r="${rr}"][data-d="${dd}"]`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    [linhas.length, agenda.dias.length],
  );

  // Pedido de foco vindo do painel de avisos.
  useEffect(() => {
    if (!focoSolicitado || focoSolicitado.nonce === ultimoNonce.current) return;
    ultimoNonce.current = focoSolicitado.nonce;
    const r = focoSolicitado.funcionarioId ? linhas.findIndex((l) => l.funcionarioId === focoSolicitado.funcionarioId) : 0;
    const d = agenda.dias.findIndex((x) => x.data === focoSolicitado.data);
    if (d >= 0) requestAnimationFrame(() => focar(Math.max(0, r), d));
  }, [focoSolicitado, linhas, agenda.dias, focar]);

  const abrir = useCallback((r: number, d: number, modo: "menu" | "motivo" = "menu") => {
    const el = grade.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-d="${d}"]`);
    if (!el) return;
    ancora.current = el;
    setMotivo("");
    setAberto({ r, d, modo });
  }, []);

  const aplicar = useCallback(
    (r: number, d: number, valor: ValorDia) => {
      const linha = linhas[r];
      const dia = agenda.dias[d];
      if (!linha || !dia) return;
      if (dia.fechado && valor.tipo === "turno") {
        toast.error("Dia fechado: reabra o dia antes de escalar.");
        return;
      }
      aoEditar(linha.funcionarioId, dia.data, valor);
    },
    [linhas, agenda.dias, aoEditar],
  );

  const iniciarTroca = (r: number, d: number) => {
    const linha = linhas[r];
    const c = linha?.celulas[d];
    if (!linha || !c) return;
    if (!celulaTrocavel(c)) {
      toast.error(
        c.tipo === "justificada" ? `${linha.nome} está de atestado nesse dia.` : c.tipo === "falta" ? `${linha.nome} tem falta registrada nesse dia.` : "Dia fechado: não há o que trocar.",
      );
      return;
    }
    if (linhas.length < 2) return;
    setAberto(null);
    setTroca({ r, d });
    focar(r, d);
  };

  const executarTroca = (r2: number) => {
    if (!troca) return;
    if (r2 === troca.r) return setTroca(null);
    const a = linhas[troca.r];
    const b = linhas[r2];
    const dia = agenda.dias[troca.d];
    if (!a || !b || !dia) return;
    const c = b.celulas[troca.d];
    if (!celulaTrocavel(c)) {
      toast.error(c?.tipo === "justificada" ? `${b.nome} está de atestado nesse dia.` : c?.tipo === "falta" ? `${b.nome} tem falta registrada nesse dia.` : "Essa pessoa não pode trocar nesse dia.");
      return;
    }
    aoTrocar(dia.data, a.funcionarioId, b.funcionarioId);
    setTroca(null);
  };

  // Esc cancela o modo troca de qualquer lugar da página.
  useEffect(() => {
    if (!troca) return;
    const aoEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setTroca(null);
    };
    document.addEventListener("keydown", aoEsc);
    return () => document.removeEventListener("keydown", aoEsc);
  }, [troca]);

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!alvo || e.ctrlKey || e.metaKey || e.altKey) return;
    const r = Number(alvo.dataset.r);
    const d = Number(alvo.dataset.d);
    if (troca) {
      // Modo troca: só a coluna do dia; Enter escolhe a pessoa, Esc cancela.
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (d === troca.d) executarTroca(r);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        focar(r + (e.key === "ArrowUp" ? -1 : 1), troca.d);
      } else if (e.key !== "Tab" && e.key !== "Escape") {
        e.preventDefault();
      }
      return;
    }
    const mover = (dr: number, dd: number) => {
      e.preventDefault();
      focar(r + dr, d + dd);
    };
    switch (e.key) {
      case "ArrowLeft":
        return mover(0, -1);
      case "ArrowRight":
        return mover(0, 1);
      case "ArrowUp":
        return mover(-1, 0);
      case "ArrowDown":
        return mover(1, 0);
      case "Home":
        return mover(0, -d);
      case "End":
        return mover(0, agenda.dias.length);
      case "PageUp":
        return mover(0, -7);
      case "PageDown":
        return mover(0, 7);
      case "Enter":
      case " ":
        e.preventDefault();
        return abrir(r, d);
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return aplicar(r, d, { tipo: "limpar" });
    }
    if (e.key.length !== 1) return;
    const tecla = e.key.toLowerCase();
    if (tecla === "f") return aplicar(r, d, { tipo: "folga" }), e.preventDefault();
    if (tecla === "a") return aplicar(r, d, { tipo: "falta" }), e.preventDefault();
    if (tecla === "j") return e.preventDefault(), abrir(r, d, "motivo");
    if (tecla === "x") return e.preventDefault(), iniciarTroca(r, d);
    // Siglas dos turnos (M, T, N…); com siglas de várias letras, digite em seguida (ex.: "ma").
    const diaSemana = agenda.dias[d]?.diaSemana ?? 0;
    const doDia = turnosAtivos.filter((t) => (t.diasSemana & (1 << diaSemana)) !== 0);
    const agora = Date.now();
    const texto = (agora < buffer.current.prazo ? buffer.current.texto : "") + tecla;
    const candidatos = doDia.filter((t) => t.sigla.toLowerCase().startsWith(texto));
    if (candidatos.length === 0) {
      buffer.current = { texto: "", prazo: 0 };
      return;
    }
    e.preventDefault();
    if (candidatos.length === 1) {
      buffer.current = { texto: "", prazo: 0 };
      const unico = candidatos[0];
      if (unico) aplicar(r, d, { tipo: "turno", turnoId: unico.id });
    } else {
      buffer.current = { texto, prazo: agora + 900 };
    }
  };

  const aoClicar = (e: MouseEvent<HTMLDivElement>) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!alvo) return;
    const r = Number(alvo.dataset.r);
    const d = Number(alvo.dataset.d);
    setFoco({ r, d });
    if (troca) {
      if (d === troca.d) executarTroca(r);
      return;
    }
    abrir(r, d);
  };

  const aoFocar = (e: React.FocusEvent<HTMLDivElement>) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!alvo) return;
    const r = Number(alvo.dataset.r);
    const d = Number(alvo.dataset.d);
    setFoco((f) => (f.r === r && f.d === d ? f : { r, d }));
  };

  const linhaAberta = aberto ? linhas[aberto.r] : undefined;
  const diaAberto = aberto ? agenda.dias[aberto.d] : undefined;
  const celulaAberta = linhaAberta && aberto ? linhaAberta.celulas[aberto.d] : undefined;

  const escolher = (valor: ValorDia) => {
    if (aberto) aplicar(aberto.r, aberto.d, valor);
    setAberto(null);
  };

  const aoSetasNoMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const botoes = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
    const i = botoes.indexOf(document.activeElement as HTMLElement);
    const proximo = botoes[(i + (e.key === "ArrowDown" ? 1 : -1) + botoes.length) % botoes.length];
    e.preventDefault();
    proximo?.focus();
  };

  const abrirDia = (e: MouseEvent<HTMLElement>, d: number) => {
    ancoraDia.current = e.currentTarget;
    setMotivoDia("");
    setAberto(null);
    setDiaMenu(d);
  };
  const diaDoMenu = diaMenu !== null ? agenda.dias[diaMenu] : undefined;
  const linhaTroca = troca ? linhas[troca.r] : undefined;
  const diaTroca = troca ? agenda.dias[troca.d] : undefined;

  const focoR = Math.min(foco.r, Math.max(0, linhas.length - 1));
  const comExtras = useMemo(() => temHoraExtra(agenda), [agenda]);
  const totalColunas = 192 + agenda.dias.length * 38 + 192 + (comExtras ? 64 : 0);

  return (
    <>
      {troca && linhaTroca && diaTroca && (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-acento/50 bg-acento/10 px-3 py-2 text-sm">
          <ArrowLeftRight className="size-4 shrink-0 text-acento" aria-hidden />
          <span className="flex-1">
            Escolha a pessoa para trocar o dia {formatarDiaMesBR(diaTroca.data)} com {linhaTroca.nome} · <kbd className="rounded border border-borda px-1 font-mono text-[10px]">Esc</kbd> cancela
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTroca(null)}>
            <X /> Cancelar
          </Button>
        </div>
      )}
      <div className="max-h-[calc(100dvh-16rem)] min-h-64 overflow-auto rounded-lg border border-borda bg-fundo">
        <div
          ref={grade}
          role="grid"
          aria-label={`Quadro da escala de ${agenda.mes}/${agenda.ano}`}
          aria-rowcount={linhas.length + 1}
          aria-colcount={agenda.dias.length + 4 + (comExtras ? 1 : 0)}
          style={{ minWidth: totalColunas }}
          onKeyDown={aoTeclar}
          onClick={aoClicar}
          onFocus={aoFocar}
        >
          <div role="row" aria-rowindex={1} className="sticky top-0 z-20 flex border-b border-borda bg-fundo">
            <div role="columnheader" className={cn(COL_NOME, "sticky left-0 z-30 flex items-end border-r border-borda bg-fundo px-2 pb-1 text-xs font-medium text-texto-suave")}>
              Funcionário
            </div>
            {agenda.dias.map((dia, d) => {
              const ehHoje = dia.data === hoje;
              return (
                <div
                  key={dia.data}
                  role="columnheader"
                  aria-label={`${NOMES_DIA_LONGO[dia.diaSemana]}, ${formatarDiaMesBR(dia.data)}${dia.fechado ? ", dia fechado" : ""}`}
                  title={dia.fechado ? `Dia fechado${dia.fechadoMotivo ? `: ${dia.fechadoMotivo}` : ""}` : undefined}
                  style={dia.fechado ? { backgroundImage: HACHURA("var(--texto)") } : undefined}
                  className={cn(CEL, "p-0 text-[10px] leading-tight", classeFundoDia(dia, hoje), troca?.d === d && "bg-acento/15", !dia.aberto && "text-texto-suave/60")}
                >
                  <button
                    type="button"
                    onClick={(e) => abrirDia(e, d)}
                    aria-label={dia.fechado ? `Reabrir ${formatarDiaMesBR(dia.data)}` : `Fechar ${formatarDiaMesBR(dia.data)} (feriado)`}
                    className="flex size-full flex-col items-center justify-end rounded-md pb-1 outline-none hover:bg-texto/[0.06] focus-visible:ring-2 focus-visible:ring-acento"
                  >
                    <span className="uppercase text-texto-suave">{nomeDiaCurto(dia.diaSemana)}</span>
                    <span className={cn("numero grid h-5 min-w-5 place-items-center rounded-full font-mono text-xs font-medium", ehHoje && "bg-acento px-1 text-acento-texto")}>
                      {Number(dia.data.slice(8, 10))}
                    </span>
                  </button>
                </div>
              );
            })}
            <div className="sticky right-0 z-30 flex border-l border-borda bg-fundo text-xs font-medium text-texto-suave">
              <div role="columnheader" className={cn(COL_STATS, "flex items-end justify-end px-2 pb-1")}>
                Horas
              </div>
              <div role="columnheader" className={cn(COL_STATS, "flex items-end justify-end px-2 pb-1")}>
                Saldo
              </div>
              <div role="columnheader" className={cn(COL_STATS, "flex items-end justify-end px-2 pb-1")}>
                Acum.
              </div>
              {comExtras && (
                <div role="columnheader" className={cn(COL_STATS, "flex items-end justify-end px-2 pb-1")}>
                  Extras
                </div>
              )}
            </div>
          </div>

          {agenda.grupos.map((grupo, gi) => (
            <div key={grupo.chave || "sem-funcao"} role="rowgroup">
              <div role="presentation" className="flex border-b border-borda bg-secondary/60">
                <div className="sticky left-0 z-10 flex h-7 items-center gap-2 px-2 text-xs font-semibold tracking-wide text-texto uppercase">
                  {grupo.nome}
                  <span className="font-mono font-normal text-texto-suave normal-case">{grupo.linhas.length}</span>
                </div>
              </div>
              {grupo.linhas.map((linha, li) => {
                const r = (inicioDoGrupo[gi] ?? 0) + li;
                return <LinhaQuadro key={linha.funcionarioId} linha={linha} r={r} dias={agenda.dias} turnos={turnosPorId} focoD={focoR === r ? foco.d : null} hoje={hoje} comExtras={comExtras} colTroca={troca?.d ?? null} origemTroca={troca?.r === r} />;
              })}
            </div>
          ))}

          <div role="presentation" className="flex border-b border-borda bg-secondary/60">
            <div className="sticky left-0 z-10 flex h-7 items-center px-2 text-xs font-semibold tracking-wide text-texto uppercase">Pessoas por turno</div>
          </div>
          {agenda.turnos.map((t) => (
            <div key={t.id} role="presentation" className="flex border-b border-borda/60">
              <div className={cn(COL_NOME, "sticky left-0 z-10 flex items-center gap-1.5 border-r border-borda bg-fundo px-2 text-sm")}>
                <span className="grid size-5 shrink-0 place-items-center rounded border font-mono text-[10px] font-semibold" style={estiloTurno(t.cor)} aria-hidden>
                  {t.sigla}
                </span>
                <span className="truncate">{t.nome}</span>
                {t.efetivoMinimo > 0 && <span className="shrink-0 text-[10px] text-texto-suave">mín. {t.efetivoMinimo}</span>}
              </div>
              {agenda.dias.map((dia, d) => {
                const n = agenda.totaisPorTurno.find((x) => x.turnoId === t.id)?.porDia[d] ?? 0;
                const funciona = (t.diasSemana & (1 << dia.diaSemana)) !== 0 && !dia.fechado;
                const lacunas = lacunasPorTurnoDia.get(`${t.id}|${dia.data}`) ?? [];
                const efetivo = lacunas.find((l) => l.tipo === "efetivo" && !l.cobertoPorExtra);
                const funcoes = lacunas.filter((l) => l.tipo === "funcao" && !l.cobertoPorExtra);
                const parciais = lacunas.filter((l) => l.cobertoPorExtra);
                const dica = [
                  efetivo ? `Faltam pessoas: ${efetivo.presentes} de ${efetivo.minimo}` : null,
                  ...funcoes.map((l) => `Falta: ${l.funcao} (${l.presentes} de ${l.minimo})`),
                  ...parciais.map((l) => textoParcial(l)),
                ]
                  .filter(Boolean)
                  .join("; ");
                return (
                  <div key={dia.data} className={cn(CEL, classeFundoDia(dia, hoje))}>
                    {funciona ? (
                      <div
                        title={dica || undefined}
                        className={cn(
                          "numero flex size-full items-center justify-center gap-0.5 rounded-md font-mono text-xs",
                          efetivo ? "bg-critico/15 font-semibold text-critico" : parciais.some((l) => l.tipo === "efetivo") ? "bg-atencao/15 font-semibold text-atencao" : "text-texto",
                        )}
                      >
                        {n}
                        {(funcoes.length > 0 || parciais.length > 0) && <TriangleAlert className="size-3 text-atencao" aria-label={dica} />}
                      </div>
                    ) : (
                      <div className="flex size-full items-center justify-center text-texto-suave/50">
                        <Minus className="size-3" aria-label={dia.fechado ? "Dia fechado" : "Turno não funciona neste dia"} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div role="presentation" className="flex border-b border-borda font-medium">
            <div className={cn(COL_NOME, "sticky left-0 z-10 flex items-center border-r border-borda bg-fundo px-2 text-sm")}>Trabalhando</div>
            {agenda.dias.map((dia, d) => (
              <div key={dia.data} className={cn(CEL, classeFundoDia(dia, hoje))}>
                <div className="numero flex size-full items-center justify-center font-mono text-xs">{agenda.trabalhandoPorDia[d] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Popover open={aberto !== null} onOpenChange={(o) => !o && setAberto(null)}>
        <PopoverAnchor virtualRef={ancora} />
        <PopoverContent
          align="start"
          className="w-64 gap-1 p-1.5"
          onKeyDown={aoSetasNoMenu}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (aberto === null) grade.current?.querySelector<HTMLElement>(`[data-r="${foco.r}"][data-d="${foco.d}"]`)?.focus();
          }}
        >
          {linhaAberta && diaAberto && celulaAberta && (
            <>
              <div className="px-1.5 pt-0.5 pb-1">
                <p className="truncate text-sm font-medium">{linhaAberta.nome}</p>
                <p className="text-xs text-texto-suave">
                  {NOMES_DIA_LONGO[diaAberto.diaSemana]}, {formatarDiaMesBR(diaAberto.data)} · {descreverCelula(celulaAberta, turnosPorId)}
                </p>
              </div>
              {diaAberto.fechado ? (
                <div className="flex flex-col gap-2 p-1.5">
                  <p className="text-xs text-texto-suave">
                    Dia fechado{diaAberto.fechadoMotivo ? `: ${diaAberto.fechadoMotivo}` : ""}. Reabra o dia para escalar alguém.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAberto(null);
                      aoReabrirDia(diaAberto.data);
                    }}
                  >
                    <CalendarCheck /> Reabrir dia
                  </Button>
                </div>
              ) : aberto?.modo === "motivo" ? (
                <form
                  className="flex flex-col gap-2 p-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    escolher({ tipo: "justificada", motivo: motivo.trim() || undefined });
                  }}
                >
                  <label htmlFor="motivo-ausencia" className="text-xs text-texto-suave">
                    Motivo da ausência justificada (opcional)
                  </label>
                  <Input id="motivo-ausencia" autoFocus maxLength={80} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: atestado, férias" />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAberto({ ...aberto, modo: "menu" })}>
                      Voltar
                    </Button>
                    <Button type="submit" size="sm">
                      <Check /> Confirmar
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-0.5" role="group" aria-label="Opções do dia">
                  {turnosAtivos.map((t) => (
                    <OpcaoMenu key={t.id} aoClicar={() => escolher({ tipo: "turno", turnoId: t.id })} atual={celulaAberta.tipo === "turno" && celulaAberta.turnoId === t.id}>
                      <span className="grid size-6 shrink-0 place-items-center rounded border font-mono text-[11px] font-semibold" style={estiloTurno(t.cor)} aria-hidden>
                        {t.sigla}
                      </span>
                      <span className="flex-1 truncate text-left">{t.nome}</span>
                      <span className="font-mono text-xs text-texto-suave">{faixaHorario(t.inicioMin, t.fimMin)}</span>
                    </OpcaoMenu>
                  ))}
                  <OpcaoMenu aoClicar={() => escolher({ tipo: "folga" })} atual={celulaAberta.tipo === "folga"} tecla="F">
                    <CircleSlash className="size-4 text-texto-suave" aria-hidden />
                    <span className="flex-1 text-left">Folga</span>
                  </OpcaoMenu>
                  <OpcaoMenu aoClicar={() => escolher({ tipo: "falta" })} atual={celulaAberta.tipo === "falta"} tecla="A">
                    <UserRoundX className="size-4 text-critico" aria-hidden />
                    <span className="flex-1 text-left">Falta</span>
                  </OpcaoMenu>
                  <OpcaoMenu aoClicar={() => setAberto((a) => (a ? { ...a, modo: "motivo" } : a))} atual={celulaAberta.tipo === "justificada"} tecla="J">
                    <Ban className="size-4 text-atencao" aria-hidden />
                    <span className="flex-1 text-left">Ausência justificada…</span>
                  </OpcaoMenu>
                  {celulaTrocavel(celulaAberta) && linhas.length > 1 && (
                    <OpcaoMenu aoClicar={() => aberto && iniciarTroca(aberto.r, aberto.d)} tecla="X">
                      <ArrowLeftRight className="size-4 text-texto-suave" aria-hidden />
                      <span className="flex-1 text-left">Trocar com…</span>
                    </OpcaoMenu>
                  )}
                  <OpcaoMenu aoClicar={() => escolher({ tipo: "limpar" })} tecla="Del">
                    <Minus className="size-4 text-texto-suave" aria-hidden />
                    <span className="flex-1 text-left">Limpar (volta ao padrão)</span>
                  </OpcaoMenu>
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>

      <Popover open={diaMenu !== null} onOpenChange={(o) => !o && setDiaMenu(null)}>
        <PopoverAnchor virtualRef={ancoraDia} />
        <PopoverContent align="start" className="w-64 gap-2 p-3" onCloseAutoFocus={(e) => e.preventDefault()}>
          {diaDoMenu && (
            <>
              <p className="text-sm font-medium">
                {NOMES_DIA_LONGO[diaDoMenu.diaSemana]}, {formatarDiaMesBR(diaDoMenu.data)}
              </p>
              {diaDoMenu.fechado ? (
                <>
                  <p className="text-xs text-texto-suave">Dia fechado{diaDoMenu.fechadoMotivo ? `: ${diaDoMenu.fechadoMotivo}` : ""}.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDiaMenu(null);
                      aoReabrirDia(diaDoMenu.data);
                    }}
                  >
                    <CalendarCheck /> Reabrir dia
                  </Button>
                </>
              ) : (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setDiaMenu(null);
                    aoFecharDia(diaDoMenu.data, motivoDia.trim());
                  }}
                >
                  <label htmlFor="motivo-dia" className="text-xs text-texto-suave">
                    Fechar dia (feriado). Motivo (opcional)
                  </label>
                  <Input id="motivo-dia" autoFocus maxLength={80} value={motivoDia} onChange={(e) => setMotivoDia(e.target.value)} placeholder="Ex.: Natal, inventário" />
                  <Button type="submit" size="sm">
                    <CalendarOff /> Fechar dia
                  </Button>
                </form>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

function OpcaoMenu({ children, aoClicar, atual, tecla }: { children: React.ReactNode; aoClicar: () => void; atual?: boolean; tecla?: string }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-current={atual ? "true" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-acento",
        atual && "bg-accent font-medium",
      )}
    >
      {children}
      {tecla && <kbd className="ml-1 rounded border border-borda px-1 font-mono text-[10px] text-texto-suave">{tecla}</kbd>}
    </button>
  );
}

function textoParcial(l: LacunaDto): string {
  const faixa = l.parcial ? `${formatarHora(l.parcial.inicioMin)}–${formatarHora(l.parcial.fimMin)}` : "";
  return `Parcial: ${l.tipo === "funcao" && l.funcao ? `${l.funcao} ` : ""}${faixa}`;
}
