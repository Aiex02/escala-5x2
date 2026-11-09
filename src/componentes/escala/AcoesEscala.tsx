"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Download, Ellipsis, RefreshCw, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { excluirMesAcao } from "@/acoes/agenda";
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
import { Button, buttonVariants } from "@/componentes/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/componentes/ui/dropdown-menu";
import { nomeMes } from "@/lib/datas";
import { gerarMesAcao } from "@/acoes/agenda";
import { BotaoGerar } from "./BotaoGerar";
import { ReequilibrarDialogo } from "./ReequilibrarDialogo";

type Props = {
  clienteId: string;
  ano: number;
  mes: number;
  gerado: boolean;
  bloqueioGerar: string | null;
  hoje: string;
  temMesesSeguintes: boolean;
};

export function AcoesEscala({ clienteId, ano, mes, gerado, bloqueioGerar, hoje, temMesesSeguintes }: Props) {
  const router = useRouter();
  const [reequilibrar, setReequilibrar] = useState(false);
  const [gerarDeNovo, setGerarDeNovo] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [pendente, iniciar] = useTransition();

  if (!gerado) return <BotaoGerar clienteId={clienteId} ano={ano} mes={mes} bloqueio={bloqueioGerar} />;

  const confirmarGerarDeNovo = () =>
    iniciar(async () => {
      const r = await gerarMesAcao(clienteId, ano, mes);
      if (r.ok) {
        toast.success(`Escala de ${nomeMes(mes)} gerada de novo.`, { description: r.dados.avisos > 0 ? `${r.dados.avisos} aviso(s) para revisar.` : "Sem avisos." });
        setGerarDeNovo(false);
      } else {
        toast.error(r.erro);
      }
    });

  const confirmarExcluir = () =>
    iniciar(async () => {
      const r = await excluirMesAcao(clienteId, ano, mes);
      if (r.ok) {
        toast.success(`Escala de ${nomeMes(mes)} excluída.`);
        setExcluir(false);
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });

  return (
    <>
      <a href={`/api/clientes/${clienteId}/escala/${ano}/${mes}/exportar`} download className={buttonVariants({ variant: "outline" })}>
        <Download aria-hidden /> <span className="hidden sm:inline">Exportar Excel</span>
        <span className="sm:hidden">Excel</span>
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Mais ações da escala">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setReequilibrar(true)}>
            <Scale aria-hidden /> Reequilibrar…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setGerarDeNovo(true)}>
            <RefreshCw aria-hidden /> Gerar de novo…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setExcluir(true)}>
            <Trash2 aria-hidden /> Excluir mês…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReequilibrarDialogo aberto={reequilibrar} aoMudar={setReequilibrar} clienteId={clienteId} ano={ano} mes={mes} hoje={hoje} temMesesSeguintes={temMesesSeguintes} />

      <AlertDialog open={gerarDeNovo} onOpenChange={(o) => !pendente && setGerarDeNovo(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar a escala de {nomeMes(mes)} de novo?</AlertDialogTitle>
            <AlertDialogDescription>
              A escala atual será descartada, inclusive os ajustes que você fez à mão no quadro. Faltas e ausências registradas continuam valendo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendente}
              onClick={(e) => {
                e.preventDefault();
                confirmarGerarDeNovo();
              }}
            >
              <CalendarClock aria-hidden /> {pendente ? "Gerando…" : "Gerar de novo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={excluir} onOpenChange={(o) => !pendente && setExcluir(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a escala de {nomeMes(mes)}?</AlertDialogTitle>
            <AlertDialogDescription>
              As jornadas, os avisos e os ajustes do mês serão apagados e o saldo de horas dos meses seguintes deixa de contar com ele. As faltas e ausências
              registradas não são apagadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pendente}
              onClick={(e) => {
                e.preventDefault();
                confirmarExcluir();
              }}
            >
              <Trash2 aria-hidden /> {pendente ? "Excluindo…" : "Excluir mês"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
