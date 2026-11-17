"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Briefcase, CalendarOff, FileUp, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { definirAtivoAcao, excluirFuncionarioAcao } from "@/acoes/funcionarios";
import { EstadoVazio } from "@/componentes/shell/EstadoVazio";
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
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/componentes/ui/select";
import { Switch } from "@/componentes/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/componentes/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/componentes/ui/tooltip";
import { formatarMinutos } from "@/motor";
import type { FuncionarioDto, PreferenciaDto } from "@/servicos/dto";
import { AusenciasDialogo } from "./AusenciasDialogo";
import { CargosDialogo } from "./CargosDialogo";
import { FuncionarioDialogo } from "./FuncionarioDialogo";

type Filtro = "ativos" | "inativos" | "todos";

const ROTULO_PREFERENCIA: Record<PreferenciaDto, string> = { MANHA: "Manhã", TARDE: "Tarde", NOITE: "Noite" };
const COR_PREFERENCIA: Record<PreferenciaDto, string> = {
  MANHA: "bg-turno-1-fundo text-turno-1-texto",
  TARDE: "bg-turno-2-fundo text-turno-2-texto",
  NOITE: "bg-turno-3-fundo text-turno-3-texto",
};

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function FuncionariosView({ clienteId, funcionarios }: { clienteId: string; funcionarios: FuncionarioDto[] }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("ativos");
  const [agrupar, setAgrupar] = useState(false);
  const [edicao, setEdicao] = useState<{ aberto: boolean; funcionario: FuncionarioDto | null }>({ aberto: false, funcionario: null });
  const [ausenciasId, setAusenciasId] = useState<string | null>(null);
  const [exclusao, setExclusao] = useState<FuncionarioDto | null>(null);
  const [cargosAberto, setCargosAberto] = useState(false);
  const [pendente, iniciar] = useTransition();

  const cargosExistentes = useMemo(() => {
    const cargos = new Set<string>();
    for (const f of funcionarios) {
      const c = f.cargo?.trim();
      if (c) cargos.add(c);
    }
    return [...cargos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [funcionarios]);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return funcionarios.filter((f) => {
      if (filtro === "ativos" && !f.ativo) return false;
      if (filtro === "inativos" && f.ativo) return false;
      if (!termo) return true;
      return [f.nome, f.matricula, f.cargo ?? "", f.secao ?? ""].some((c) => normalizar(c).includes(termo));
    });
  }, [funcionarios, busca, filtro]);

  const grupos = useMemo(() => {
    if (!agrupar) return [{ titulo: null as string | null, itens: filtrados }];
    const mapa = new Map<string, FuncionarioDto[]>();
    for (const f of filtrados) {
      const cargo = f.cargo ?? "Sem cargo";
      mapa.set(cargo, [...(mapa.get(cargo) ?? []), f]);
    }
    return [...mapa.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([titulo, itens]) => ({ titulo, itens }));
  }, [filtrados, agrupar]);

  const funcionarioAusencias = funcionarios.find((f) => f.id === ausenciasId) ?? null;

  function alternarAtivo(f: FuncionarioDto, ativo: boolean) {
    iniciar(async () => {
      const r = await definirAtivoAcao(clienteId, f.id, ativo);
      if (r.ok) toast.success(`${f.nome} ${ativo ? "ativado" : "inativado"}.`);
      else toast.error(r.erro);
    });
  }

  function excluir() {
    const alvo = exclusao;
    if (!alvo) return;
    iniciar(async () => {
      const r = await excluirFuncionarioAcao(clienteId, alvo.id);
      if (r.ok) toast.success(`${alvo.nome} excluído.`);
      else toast.error(r.erro);
      setExclusao(null);
    });
  }

  const botaoAdicionar = (
    <Button onClick={() => setEdicao({ aberto: true, funcionario: null })}>
      <Plus aria-hidden /> Adicionar
    </Button>
  );
  const botaoCargos = (
    <Button variant="outline" onClick={() => setCargosAberto(true)}>
      <Briefcase aria-hidden /> Cargos
    </Button>
  );
  const botaoImportar = (
    <Button variant="outline" asChild>
      <Link href={`/clientes/${clienteId}/importar`}>
        <FileUp aria-hidden /> Importar planilha
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      {funcionarios.length === 0 ? (
        <EstadoVazio
          icone={Users}
          titulo="Nenhum funcionário ainda"
          descricao="Importe uma planilha com a equipe ou adicione as pessoas uma a uma. Depois é só gerar a escala."
        >
          <div className="flex flex-wrap gap-2">
            {botaoImportar}
            {botaoAdicionar}
          </div>
        </EstadoVazio>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative w-full sm:w-72">
              <Label htmlFor="busca" className="sr-only">
                Buscar funcionário
              </Label>
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-texto-suave" aria-hidden />
              <Input id="busca" className="pl-8" placeholder="Buscar por nome, matrícula, cargo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="filtro" className="sr-only">
                Situação
              </Label>
              <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
                <SelectTrigger id="filtro" className="w-36">
                  <SelectValue>{filtro === "ativos" ? "Ativos" : filtro === "inativos" ? "Inativos" : "Todos"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativos">Ativos</SelectItem>
                  <SelectItem value="inativos">Inativos</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="agrupar" checked={agrupar} onCheckedChange={setAgrupar} />
              <Label htmlFor="agrupar">Agrupar por cargo</Label>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {botaoCargos}
              {botaoImportar}
              {botaoAdicionar}
            </div>
          </div>

          <p className="numero text-sm text-texto-suave" aria-live="polite">
            {filtrados.length} de {funcionarios.length} {funcionarios.length === 1 ? "funcionário" : "funcionários"}
          </p>

          <div className="overflow-x-auto rounded-lg border border-borda bg-superficie">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Seção</TableHead>
                  <TableHead>Preferência</TableHead>
                  <TableHead className="text-right">Carga semanal</TableHead>
                  <TableHead className="text-right">Horas não trabalhadas</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-texto-suave">
                      Ninguém encontrado com esse filtro.
                    </TableCell>
                  </TableRow>
                )}
                {grupos.map((g) => (
                  <Fragment key={g.titulo ?? "todos"}>
                    {g.titulo !== null && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={9} className="font-display text-sm font-semibold">
                          {g.titulo} <span className="numero font-mono text-xs font-normal text-texto-suave">({g.itens.length})</span>
                        </TableCell>
                      </TableRow>
                    )}
                    {g.itens.map((f) => (
                      <TableRow key={f.id} className={f.ativo ? undefined : "text-texto-suave"}>
                        <TableCell className="font-medium">
                          <span className="flex flex-wrap items-center gap-2">
                            {f.nome}
                            {f.isentoEc141 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" tabIndex={0}>
                                    Isento EC 141
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>Fora das regras de jornada da lei: valem só as regras da empresa.</TooltipContent>
                              </Tooltip>
                            )}
                            {f.ausencias.length > 0 && (
                              <span className="numero font-mono text-xs text-texto-suave">
                                {f.ausencias.length} {f.ausencias.length === 1 ? "ausência" : "ausências"}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="numero font-mono">{f.matricula}</TableCell>
                        <TableCell>{f.cargo ?? "—"}</TableCell>
                        <TableCell>{f.secao ?? "—"}</TableCell>
                        <TableCell>
                          {f.preferencia ? (
                            <Badge className={COR_PREFERENCIA[f.preferencia]}>{ROTULO_PREFERENCIA[f.preferencia]}</Badge>
                          ) : (
                            <span className="text-texto-suave">—</span>
                          )}
                        </TableCell>
                        <TableCell className="numero text-right font-mono">
                          {f.cargaSemanalMin === null ? <span className="text-texto-suave">regra do cliente</span> : formatarMinutos(f.cargaSemanalMin)}
                        </TableCell>
                        <TableCell className="numero text-right font-mono">
                          {f.horasNaoTrabalhadasMin === null ? <span className="text-texto-suave">—</span> : formatarMinutos(f.horasNaoTrabalhadasMin)}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={f.ativo}
                            disabled={pendente}
                            onCheckedChange={(v) => alternarAtivo(f, v)}
                            aria-label={`${f.nome}: ativo`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon-sm" aria-label={`Ausências de ${f.nome}`} onClick={() => setAusenciasId(f.id)}>
                              <CalendarOff aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Editar ${f.nome}`} onClick={() => setEdicao({ aberto: true, funcionario: f })}>
                              <Pencil aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${f.nome}`} onClick={() => setExclusao(f)}>
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <FuncionarioDialogo
        clienteId={clienteId}
        funcionario={edicao.funcionario}
        aberto={edicao.aberto}
        aoMudarAberto={(aberto) => setEdicao((e) => ({ ...e, aberto }))}
        cargosExistentes={cargosExistentes}
      />
      <CargosDialogo clienteId={clienteId} funcionarios={funcionarios} aberto={cargosAberto} aoMudarAberto={setCargosAberto} />
      <AusenciasDialogo
        clienteId={clienteId}
        funcionario={funcionarioAusencias}
        aberto={ausenciasId !== null}
        aoMudarAberto={(aberto) => !aberto && setAusenciasId(null)}
      />
      <AlertDialog open={exclusao !== null} onOpenChange={(aberto) => !aberto && setExclusao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {exclusao?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa e as ausências dela serão apagadas. Se ela já aparece em escalas geradas, o app recusa: nesse caso, inative.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={excluir}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
