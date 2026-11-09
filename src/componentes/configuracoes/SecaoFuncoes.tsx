"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { dimensionarAcao, salvarFuncoesAcao } from "@/acoes/configuracao";
import { Button } from "@/componentes/ui/button";
import { EstadoVazio } from "@/componentes/shell/EstadoVazio";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/componentes/ui/table";
import { textoContratar } from "@/lib/dimensionamento";
import { etapasEc141, formatarDataBR } from "@/motor";
import type { ConfiguracaoDto, DimensionamentoDto, LinhaDimensionamentoDto } from "@/servicos/dto";

const numeroBR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function SecaoFuncoes({ config }: { config: ConfiguracaoDto }) {
  const [minimos, setMinimos] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.funcoes.map((f) => [f.chave, String(f.minimo)])),
  );
  const [pendente, iniciar] = useTransition();
  const [dimensionamento, setDimensionamento] = useState<DimensionamentoDto>(config.dimensionamento);
  const [dataRef, setDataRef] = useState(config.hoje);
  const [calculando, setCalculando] = useState(false);
  const ultimaConsulta = useRef(0);

  // Atalhos: início de cada fase futura da lei.
  const atalhos =
    config.regime === "EC141"
      ? etapasEc141(config.publicacao)
          .filter((e) => e.vigencia > config.hoje)
          .map((e) => ({ data: e.vigencia, rotulo: `${Math.round(e.cargaSemanalMaxMin / 60)}h · ${e.folgasSemanaisMin} folgas` }))
      : [];

  async function recalcular(data: string) {
    const consulta = ++ultimaConsulta.current;
    setCalculando(true);
    const r = await dimensionarAcao(config.clienteId, data);
    if (consulta !== ultimaConsulta.current) return;
    setCalculando(false);
    if (r.ok) setDimensionamento(r.dados);
    else toast.error(r.erro);
  }

  // Muda a data de referência: a capacidade depende da fase da lei vigente.
  function mudarData(data: string) {
    setDataRef(data);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data) && data !== dimensionamento.dataReferencia) void recalcular(data);
  }

  if (config.funcoes.length === 0) {
    return (
      <EstadoVazio
        icone={Users}
        titulo="Nenhuma função ainda"
        descricao="As funções vêm dos cargos dos funcionários ativos. Cadastre ou importe funcionários com cargo."
        acao={{ rotulo: "Ir para Funcionários", href: `/clientes/${config.clienteId}/funcionarios` }}
      />
    );
  }

  function lerMinimo(chave: string): number | null {
    const n = Number(minimos[chave]);
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
  }
  const invalido = config.funcoes.some((f) => lerMinimo(f.chave) === null);
  const rascunho = config.funcoes.some((f) => lerMinimo(f.chave) !== f.minimo);

  function salvar() {
    iniciar(async () => {
      const r = await salvarFuncoesAcao({
        clienteId: config.clienteId,
        minimos: config.funcoes.map((f) => ({ chave: f.chave, minimo: lerMinimo(f.chave) ?? 0 })),
      });
      if (r.ok) {
        toast.success("Mínimos por função salvos.");
        await recalcular(dataRef);
      } else toast.error(r.erro);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm text-texto-suave">
          Por padrão nenhuma função é exigida: só o efetivo mínimo de cada turno conta. Informe um número apenas para as funções
          que precisam de alguém em todo turno (ex.: Barista 1); 0 = não exige. Cargos escritos de jeitos parecidos
          (&quot;Atendente&quot;, &quot;atendente&quot;) contam como a mesma função.
        </p>
        <div className="overflow-x-auto rounded-lg border border-borda bg-superficie">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Função</TableHead>
                <TableHead className="text-right">Pessoas ativas</TableHead>
                <TableHead>Mínimo por turno</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.funcoes.map((f) => (
                <TableRow key={f.chave}>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell className="numero text-right font-mono">{f.pessoas}</TableCell>
                  <TableCell>
                    <Label htmlFor={`min-${f.chave}`} className="sr-only">
                      Mínimo por turno de {f.nome}
                    </Label>
                    <Input
                      id={`min-${f.chave}`}
                      type="number"
                      min={0}
                      max={99}
                      inputMode="numeric"
                      className="numero w-20 font-mono"
                      value={minimos[f.chave] ?? ""}
                      onChange={(e) => setMinimos((m) => ({ ...m, [f.chave]: e.target.value }))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button onClick={salvar} disabled={pendente || invalido}>
          {pendente && <Loader2 className="animate-spin" aria-hidden />}
          Salvar mínimos
        </Button>
      </div>

      <section aria-labelledby="titulo-dimensionamento" className="space-y-3">
        <div>
          <h3 id="titulo-dimensionamento" className="text-base font-semibold">
            Dimensionamento da equipe
          </h3>
          <p className="text-sm text-texto-suave">
            Quantas pessoas cada função precisa para cobrir o mínimo em todos os turnos, dentro das regras da fase da lei.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dim-data">Data de referência</Label>
            <Input id="dim-data" type="date" value={dataRef} onChange={(e) => mudarData(e.target.value)} className="w-44" />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => mudarData(config.hoje)} disabled={dataRef === config.hoje}>
            Hoje
          </Button>
          {atalhos.map((a) => (
            <Button key={a.data} type="button" variant="outline" size="sm" onClick={() => mudarData(a.data)} disabled={dataRef === a.data}>
              A partir de {formatarDataBR(a.data)} ({a.rotulo})
            </Button>
          ))}
          {calculando && <Loader2 className="mb-2 size-4 animate-spin text-texto-suave" aria-label="Calculando" />}
        </div>
        <p className="text-xs text-texto-suave">
          {dimensionamento.periodo}: {dimensionamento.limites}. Margem de {dimensionamento.margemAusenciasPct}% para férias, atestados e faltas.
          {rascunho && " Salve os mínimos para recalcular com os valores digitados."}
        </p>

        {dimensionamento.faltas.length > 0 ? (
          <ul className="space-y-2" aria-label="Contratações necessárias">
            {dimensionamento.faltas.map((f) => (
              <li
                key={f.funcao || "geral"}
                className="flex items-start gap-2 rounded-lg border border-critico/50 bg-critico/10 px-3 py-2 text-sm font-medium text-critico"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{textoContratar(f, f.funcao === "")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
            A equipe atual cobre o mínimo de todas as funções nesta semana.
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border border-borda bg-superficie">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Função</TableHead>
                <TableHead className="text-right">Mínimo/turno</TableHead>
                <TableHead className="text-right">Pessoas</TableHead>
                <TableHead>Cobertura</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dimensionamento.linhas.map((l) => (
                <LinhaDim key={l.funcao || "geral"} l={l} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function LinhaDim({ l }: { l: LinhaDimensionamentoDto }) {
  const falta = l.faltamPessoas > 0;
  return (
    <TableRow>
      <TableCell className="font-medium">{l.nome}</TableCell>
      <TableCell className="numero text-right font-mono">{numeroBR.format(l.minimoPorTurno)}</TableCell>
      <TableCell className="numero text-right font-mono">{l.pessoas}</TableCell>
      <TableCell className="numero font-mono text-sm">
        Cobre {numeroBR.format(l.capacidadeTurnosSemana)} de {l.demandaTurnosSemana} turnos/semana
      </TableCell>
      <TableCell className="min-w-56 whitespace-normal text-sm">
        {l.demandaTurnosSemana === 0 ? (
          <span className="text-texto-suave">Sem exigência</span>
        ) : falta ? (
          <span className="flex items-start gap-2 font-medium text-critico">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {textoContratar(l, l.funcao === "")}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
            Equipe suficiente
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
