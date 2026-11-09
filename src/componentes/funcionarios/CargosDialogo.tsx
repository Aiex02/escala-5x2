"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { renomearCargoAcao } from "@/acoes/funcionarios";
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
import { Badge } from "@/componentes/ui/badge";
import { Button } from "@/componentes/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/componentes/ui/dialog";
import { Input } from "@/componentes/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/componentes/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/componentes/ui/table";
import { chaveFuncao } from "@/motor";
import type { FuncionarioDto } from "@/servicos/dto";

type Props = {
  clienteId: string;
  funcionarios: FuncionarioDto[];
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
};

type ItemCargo = { cargo: string; ativos: number; total: number; chave: string };

function plural(n: number): string {
  return n === 1 ? "1 funcionário" : `${n} funcionários`;
}

export function CargosDialogo({ clienteId, funcionarios, aberto, aoMudarAberto }: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [uniao, setUniao] = useState<{ de: string; para: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  const { cargos, semCargo } = useMemo(() => {
    const mapa = new Map<string, ItemCargo>();
    let sem = 0;
    for (const f of funcionarios) {
      const cargo = f.cargo?.trim();
      if (!cargo) {
        sem += 1;
        continue;
      }
      const item = mapa.get(cargo) ?? { cargo, ativos: 0, total: 0, chave: chaveFuncao(cargo) };
      item.total += 1;
      if (f.ativo) item.ativos += 1;
      mapa.set(cargo, item);
    }
    return { cargos: [...mapa.values()].sort((a, b) => a.cargo.localeCompare(b.cargo, "pt-BR")), semCargo: sem };
  }, [funcionarios]);

  /** Para cada cargo, outro cargo escrito diferente que conta como a mesma função. */
  const mesmaFuncao = useMemo(() => {
    const porChave = new Map<string, string[]>();
    for (const c of cargos) porChave.set(c.chave, [...(porChave.get(c.chave) ?? []), c.cargo]);
    const resultado = new Map<string, string>();
    for (const c of cargos) {
      const outro = (porChave.get(c.chave) ?? []).find((x) => x !== c.cargo);
      if (outro) resultado.set(c.cargo, outro);
    }
    return resultado;
  }, [cargos]);

  function iniciarEdicao(cargo: string) {
    setEditando(cargo);
    setRascunho(cargo);
  }

  function renomear(de: string, para: string, aoConcluir?: () => void) {
    iniciar(async () => {
      const r = await renomearCargoAcao({ clienteId, de, para });
      if (r.ok) {
        toast.success(`Cargo renomeado em ${plural(r.dados.afetados)}.`);
        aoConcluir?.();
      } else toast.error(r.erro);
    });
  }

  function salvarEdicao(de: string) {
    const novo = rascunho.trim();
    if (novo === de) {
      setEditando(null);
      return;
    }
    renomear(de, novo, () => setEditando(null));
  }

  function confirmarUniao() {
    const alvo = uniao;
    if (!alvo) return;
    iniciar(async () => {
      const r = await renomearCargoAcao({ clienteId, de: alvo.de, para: alvo.para });
      if (r.ok) toast.success(`Cargo renomeado em ${plural(r.dados.afetados)}.`);
      else toast.error(r.erro);
      setUniao(null);
    });
  }

  const totalUniao = cargos.find((c) => c.cargo === uniao?.de)?.total ?? 0;

  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent
        className="sm:max-w-2xl"
        // Esc durante a edição de um nome cancela só a edição; o Radix ouve o Esc no documento, antes do input.
        onEscapeKeyDown={(e) => {
          if (editando === null) return;
          e.preventDefault();
          setEditando(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Cargos da equipe</DialogTitle>
          <DialogDescription>Renomeie ou una cargos. A mudança vale para todos os funcionários que têm o cargo.</DialogDescription>
        </DialogHeader>

        {cargos.length === 0 ? (
          <p className="text-sm text-texto-suave">Nenhum funcionário tem cargo ainda.</p>
        ) : (
          <div className="space-y-3">
            {mesmaFuncao.size > 0 && (
              <p role="status" className="rounded-lg border border-borda bg-muted/50 px-3 py-2 text-sm">
                Cargos escritos de jeitos diferentes contam como a mesma função nos mínimos por turno. Una-os para deixar o cadastro limpo.
              </p>
            )}
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-borda">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cargo</TableHead>
                    <TableHead className="text-right">Pessoas</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cargos.map((c) => {
                    const igual = mesmaFuncao.get(c.cargo);
                    const emEdicao = editando === c.cargo;
                    return (
                      <TableRow key={c.cargo}>
                        <TableCell className="font-medium">
                          {emEdicao ? (
                            <Input
                              aria-label={`Novo nome para o cargo ${c.cargo}`}
                              value={rascunho}
                              maxLength={60}
                              autoFocus
                              disabled={pendente}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setRascunho(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  salvarEdicao(c.cargo);
                                }
                              }}
                            />
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              {c.cargo}
                              {igual && <Badge variant="outline">Mesma função que {igual}</Badge>}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="numero text-right font-mono">
                          {c.ativos === c.total ? c.ativos : `${c.ativos} / ${c.total}`}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {emEdicao ? (
                              <>
                                <Button size="sm" onClick={() => salvarEdicao(c.cargo)} disabled={pendente || rascunho.trim() === ""}>
                                  {pendente ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                                  Salvar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditando(null)} disabled={pendente}>
                                  <X aria-hidden /> Cancelar
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Renomear ${c.cargo}`}
                                  onClick={() => iniciarEdicao(c.cargo)}
                                  disabled={pendente}
                                >
                                  <Pencil aria-hidden />
                                </Button>
                                {cargos.length > 1 && (
                                  <Select value="" onValueChange={(v) => v && setUniao({ de: c.cargo, para: v })} disabled={pendente}>
                                    <SelectTrigger size="sm" className="w-36" aria-label={`Unir ${c.cargo} com outro cargo`}>
                                      <SelectValue placeholder="Unir com…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {cargos
                                        .filter((o) => o.cargo !== c.cargo)
                                        .map((o) => (
                                          <SelectItem key={o.cargo} value={o.cargo}>
                                            {o.cargo}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {semCargo > 0 && (
                    <TableRow className="text-texto-suave hover:bg-transparent">
                      <TableCell>Sem cargo</TableCell>
                      <TableCell className="numero text-right font-mono">{semCargo}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <AlertDialog open={uniao !== null} onOpenChange={(a) => !a && !pendente && setUniao(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Unir &quot;{uniao?.de}&quot; a &quot;{uniao?.para}&quot;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Todos os {totalUniao} funcionários com cargo {uniao?.de} passam a ter o cargo {uniao?.para}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmarUniao} disabled={pendente}>
                Unir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
