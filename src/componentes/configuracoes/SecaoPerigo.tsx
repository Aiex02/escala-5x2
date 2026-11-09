"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { excluirClienteAcao, renomearClienteAcao } from "@/acoes/clientes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/componentes/ui/alert-dialog";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";

export function SecaoPerigo({ clienteId, nome }: { clienteId: string; nome: string }) {
  const router = useRouter();
  const [novoNome, setNovoNome] = useState(nome);
  const [renomeando, iniciarRenomear] = useTransition();
  const [excluindo, iniciarExcluir] = useTransition();

  function renomear(e: React.FormEvent) {
    e.preventDefault();
    iniciarRenomear(async () => {
      const r = await renomearClienteAcao(clienteId, novoNome);
      if (r.ok) toast.success("Cliente renomeado.");
      else toast.error(r.erro);
    });
  }

  function excluir() {
    iniciarExcluir(async () => {
      const r = await excluirClienteAcao(clienteId);
      if (r.ok) {
        toast.success(`Cliente ${nome} excluído.`);
        router.push("/");
      } else toast.error(r.erro);
    });
  }

  return (
    <div className="space-y-8">
      <form onSubmit={renomear} className="max-w-md space-y-2">
        <Label htmlFor="renomear">Nome do cliente</Label>
        <div className="flex gap-2">
          <Input id="renomear" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} maxLength={80} />
          <Button type="submit" disabled={renomeando || novoNome.trim() === nome || novoNome.trim().length < 2}>
            {renomeando && <Loader2 className="animate-spin" aria-hidden />}
            Renomear
          </Button>
        </div>
      </form>

      <div className="max-w-xl space-y-3 rounded-lg border border-critico/40 bg-critico/5 p-4">
        <h3 className="font-display text-base font-semibold text-critico">Excluir cliente</h3>
        <p className="text-sm">
          Apaga {nome} com os funcionários, turnos, configurações e todas as escalas geradas. Não dá para desfazer.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 aria-hidden /> Excluir cliente
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {nome}?</AlertDialogTitle>
              <AlertDialogDescription>
                Todos os dados deste cliente serão apagados de forma definitiva: funcionários, turnos, regras e escalas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={excluir} disabled={excluindo}>
                Excluir definitivamente
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
