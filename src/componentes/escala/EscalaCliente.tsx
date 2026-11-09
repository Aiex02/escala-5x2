"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { definirDiaAcao, fecharDiaAcao, reabrirDiaAcao, reequilibrarAcao, trocarDiaAcao } from "@/acoes/agenda";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/componentes/ui/alert-dialog";
import { somarDias } from "@/motor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/componentes/ui/tabs";
import type { AgendaMesDto, AvisoAgendaDto, ValorDia } from "@/servicos/agendaDto";
import { BannerFaltaPessoal } from "./BannerFaltaPessoal";
import { LegendaTurnos } from "./LegendaTurnos";
import { PainelAvisos } from "./PainelAvisos";
import { Quadro, type FocoSolicitado } from "./Quadro";
import { VisaoMes } from "./VisaoMes";
import { VisaoSemana } from "./VisaoSemana";
import { aplicarOtimista, aplicarTrocaOtimista } from "./util";

type Props = { agenda: AgendaMesDto; hoje: string };

type AusenciaPendente = { funcionarioId: string; data: string; valor: ValorDia; mensagem: string };
type FechamentoPendente = { data: string; motivo: string; pessoas: number };

/** Conteúdo de um mês gerado: estado da agenda, edição otimista e abas Quadro, Mês e Semana. */
export function EscalaCliente({ agenda: agendaInicial, hoje }: Props) {
  const [agenda, setAgenda] = useState(agendaInicial);
  const [origem, setOrigem] = useState(agendaInicial);
  const [aba, setAba] = useState("quadro");
  const [foco, setFoco] = useState<FocoSolicitado | null>(null);
  const [ausenciaPendente, setAusenciaPendente] = useState<AusenciaPendente | null>(null);
  const [fechamento, setFechamento] = useState<FechamentoPendente | null>(null);
  const confirmada = useRef(agendaInicial);
  const fila = useRef<Promise<void>>(Promise.resolve());
  const nonce = useRef(0);

  // A página foi renderizada de novo no servidor (gerar, reequilibrar…): adota a agenda nova.
  if (agendaInicial !== origem) {
    setOrigem(agendaInicial);
    setAgenda(agendaInicial);
  }
  useEffect(() => {
    confirmada.current = agendaInicial;
  }, [agendaInicial]);

  /** Enfileira uma operação no servidor: cada resposta já traz as anteriores. */
  const enfileirar = useCallback((operacao: () => Promise<void>) => {
    fila.current = fila.current.then(operacao);
  }, []);

  const editar = useCallback(
    (funcionarioId: string, data: string, valor: ValorDia, substituirAusencia = false) => {
      // Turno ou folga sobre atestado/falta: pede confirmação antes de substituir a ausência.
      if (!substituirAusencia && (valor.tipo === "turno" || valor.tipo === "folga")) {
        const i = agenda.dias.findIndex((d) => d.data === data);
        const celula = agenda.grupos.flatMap((g) => g.linhas).find((l) => l.funcionarioId === funcionarioId)?.celulas[i];
        if (celula?.tipo === "justificada" || celula?.tipo === "falta") {
          const motivo = celula.tipo === "justificada" ? celula.motivo?.trim() : null;
          setAusenciaPendente({
            funcionarioId,
            data,
            valor,
            mensagem: `Esse dia está marcado como ${celula.tipo === "justificada" ? "atestado" : "falta"}${motivo ? ` (${motivo})` : ""}. Substituir?`,
          });
          return;
        }
      }
      setAgenda((a) => aplicarOtimista(a, funcionarioId, data, valor));
      enfileirar(async () => {
        const r = await definirDiaAcao(agendaInicial.clienteId, funcionarioId, data, valor, substituirAusencia);
        if (r.ok) {
          confirmada.current = r.dados;
          setAgenda(r.dados);
        } else {
          setAgenda(confirmada.current);
          if (r.codigo === "diaComAusencia") setAusenciaPendente({ funcionarioId, data, valor, mensagem: r.erro });
          else toast.error(r.erro);
        }
      });
    },
    [agenda.dias, agenda.grupos, agendaInicial.clienteId, enfileirar],
  );

  const trocar = useCallback(
    (data: string, funcionarioA: string, funcionarioB: string) => {
      setAgenda((a) => aplicarTrocaOtimista(a, data, funcionarioA, funcionarioB));
      enfileirar(async () => {
        const r = await trocarDiaAcao(agendaInicial.clienteId, data, funcionarioA, funcionarioB);
        if (r.ok) {
          confirmada.current = r.dados;
          setAgenda(r.dados);
        } else {
          toast.error(r.erro);
          setAgenda(confirmada.current);
        }
      });
    },
    [agendaInicial.clienteId, enfileirar],
  );

  const executarFechamento = useCallback(
    (data: string, motivo: string, reequilibrar: boolean) => {
      enfileirar(async () => {
        const r = await fecharDiaAcao(agendaInicial.clienteId, data, motivo);
        if (!r.ok) {
          toast.error(r.erro);
          return;
        }
        confirmada.current = r.dados;
        setAgenda(r.dados);
        const amanha = somarDias(data, 1);
        const ultimo = r.dados.dias[r.dados.dias.length - 1]?.data ?? data;
        if (!reequilibrar || amanha > ultimo) {
          toast.success("Dia fechado.");
          return;
        }
        const rr = await reequilibrarAcao(agendaInicial.clienteId, agendaInicial.ano, agendaInicial.mes, amanha, false);
        if (rr.ok) toast.success("Dia fechado e mês reequilibrado a partir de amanhã.");
        else toast.error(rr.erro);
      });
    },
    [agendaInicial.clienteId, agendaInicial.ano, agendaInicial.mes, enfileirar],
  );

  const fecharDia = useCallback(
    (data: string, motivo: string) => {
      const i = agenda.dias.findIndex((d) => d.data === data);
      const pessoas = agenda.trabalhandoPorDia[i] ?? 0;
      if (pessoas > 0) setFechamento({ data, motivo, pessoas });
      else executarFechamento(data, motivo, false);
    },
    [agenda.dias, agenda.trabalhandoPorDia, executarFechamento],
  );

  const reabrirDia = useCallback(
    (data: string) => {
      enfileirar(async () => {
        const r = await reabrirDiaAcao(agendaInicial.clienteId, data);
        if (r.ok) {
          confirmada.current = r.dados;
          setAgenda(r.dados);
          toast.success("Dia reaberto. Reequilibre o mês para escalar alguém nele.");
        } else {
          toast.error(r.erro);
        }
      });
    },
    [agendaInicial.clienteId, enfileirar],
  );

  const focarAviso = (aviso: AvisoAgendaDto) => {
    if (!aviso.data) return;
    nonce.current += 1;
    setFoco({ funcionarioId: aviso.funcionarioId, data: aviso.data, nonce: nonce.current });
    setAba("quadro");
  };

  return (
    <div className="flex flex-col gap-4">
      <BannerFaltaPessoal clienteId={agenda.clienteId} faltas={agenda.dimensionamento.faltas} />
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="quadro">Quadro</TabsTrigger>
          <TabsTrigger value="mes">Mês</TabsTrigger>
          <TabsTrigger value="semana">Semana</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="quadro" className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <LegendaTurnos turnos={agenda.turnos} />
              <Quadro agenda={agenda} hoje={hoje} focoSolicitado={foco} aoEditar={editar} aoTrocar={trocar} aoFecharDia={fecharDia} aoReabrirDia={reabrirDia} />
              <p className="text-xs text-texto-suave">
                Setas movem o foco. Enter abre as opções do dia. Teclas: sigla do turno (ex.: {agenda.turnos[0]?.sigla ?? "M"}), F folga, A falta, J ausência
                justificada, X troca o dia com outra pessoa, Delete limpa. Clique no dia do cabeçalho para fechar (feriado).
              </p>
            </div>
            <PainelAvisos avisos={agenda.avisos} faltas={agenda.dimensionamento.faltas} aoFocar={focarAviso} />
          </TabsContent>
          <TabsContent value="mes">
            <VisaoMes agenda={agenda} hoje={hoje} />
          </TabsContent>
          <TabsContent value="semana">
            <VisaoSemana agenda={agenda} hoje={hoje} />
          </TabsContent>
        </div>
      </Tabs>

      <AlertDialog open={ausenciaPendente !== null} onOpenChange={(o) => !o && setAusenciaPendente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir a ausência?</AlertDialogTitle>
            <AlertDialogDescription>{ausenciaPendente?.mensagem}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (ausenciaPendente) editar(ausenciaPendente.funcionarioId, ausenciaPendente.data, ausenciaPendente.valor, true);
                setAusenciaPendente(null);
              }}
            >
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={fechamento !== null} onOpenChange={(o) => !o && setFechamento(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar o dia {fechamento ? `${fechamento.data.slice(8, 10)}/${fechamento.data.slice(5, 7)}` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              {fechamento?.pessoas} {fechamento?.pessoas === 1 ? "pessoa estava escalada" : "pessoas estavam escaladas"}; o dia ficará sem ninguém. Reequilibrar depois?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                if (fechamento) executarFechamento(fechamento.data, fechamento.motivo, false);
                setFechamento(null);
              }}
            >
              Só fechar o dia
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (fechamento) executarFechamento(fechamento.data, fechamento.motivo, true);
                setFechamento(null);
              }}
            >
              Fechar dia e reequilibrar a partir de amanhã
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
