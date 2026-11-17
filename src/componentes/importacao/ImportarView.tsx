"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { importarPlanilhaAcao } from "@/acoes/importacao";
import { Badge } from "@/componentes/ui/badge";
import { Button } from "@/componentes/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/componentes/ui/table";
import { cn } from "@/lib/utils";
import type { ResultadoImportacaoDto } from "@/servicos/dto";

const LIMITE_BYTES = 10 * 1024 * 1024;

function Contagem({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: "critico" }) {
  return (
    <div className="rounded-lg border border-borda bg-superficie px-4 py-3">
      <p className={cn("numero font-mono text-2xl font-semibold", destaque === "critico" && valor > 0 && "text-critico")}>{valor}</p>
      <p className="text-sm text-texto-suave">{rotulo}</p>
    </div>
  );
}

export function ImportarView({ clienteId }: { clienteId: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoDto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modoAtual, setModoAtual] = useState<"validar" | "importar" | null>(null);
  const [pendente, iniciar] = useTransition();

  function escolher(f: File | null) {
    setResultado(null);
    setErro(null);
    if (f && !f.name.toLowerCase().endsWith(".xlsx")) {
      setArquivo(null);
      setErro("O arquivo deve ser uma planilha .xlsx.");
      return;
    }
    if (f && f.size > LIMITE_BYTES) {
      setArquivo(null);
      setErro("O arquivo passa de 10 MB.");
      return;
    }
    setArquivo(f);
  }

  function enviar(modo: "validar" | "importar") {
    if (!arquivo) return;
    const dados = new FormData();
    dados.set("arquivo", arquivo);
    dados.set("modo", modo);
    setModoAtual(modo);
    setErro(null);
    iniciar(async () => {
      const r = await importarPlanilhaAcao(clienteId, dados);
      if (!r.ok) {
        setResultado(null);
        setErro(r.erro);
        toast.error(r.erro);
        return;
      }
      setResultado(r.dados);
      if (modo === "importar") toast.success(`Importação concluída: ${r.dados.novas} novos, ${r.dados.atualizadas} atualizados.`);
      else toast.success("Planilha validada. Nada foi gravado.");
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <section className="space-y-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            escolher(e.dataTransfer.files[0] ?? null);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
            arrastando ? "border-acento bg-acento/8" : "border-borda bg-superficie",
          )}
        >
          <span className="grid size-11 place-items-center rounded-lg bg-acento/12 text-acento">
            {arquivo ? <FileSpreadsheet className="size-5" aria-hidden /> : <Upload className="size-5" aria-hidden />}
          </span>
          {arquivo ? (
            <p className="font-medium">
              {arquivo.name} <span className="numero font-mono text-sm font-normal text-texto-suave">({Math.max(1, Math.round(arquivo.size / 1024))} KB)</span>
            </p>
          ) : (
            <p className="font-medium">Arraste a planilha .xlsx aqui</p>
          )}
          <input
            ref={entrada}
            id="arquivo"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label="Planilha de funcionários (.xlsx)"
            onChange={(e) => escolher(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" onClick={() => entrada.current?.click()} disabled={pendente}>
            {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
          </Button>
          <p className="text-xs text-texto-suave">
            Aceita a planilha modelo do app ou o quadro de horário convertido do PDF. Até 10 MB.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => enviar("validar")} disabled={!arquivo || pendente}>
            {pendente && modoAtual === "validar" && <Loader2 className="animate-spin" aria-hidden />}
            Validar
          </Button>
          <Button onClick={() => enviar("importar")} disabled={!arquivo || pendente}>
            {pendente && modoAtual === "importar" && <Loader2 className="animate-spin" aria-hidden />}
            Importar
          </Button>
          <Button variant="link" asChild className="ml-auto">
            <a href="/api/planilha-modelo" download>
              <Download aria-hidden /> Baixar planilha modelo
            </a>
          </Button>
        </div>
        <p className="text-xs text-texto-suave">
          &quot;Validar&quot; só confere o arquivo e mostra o que mudaria. A matrícula identifica a pessoa: quem já existe é atualizado
          (nome e cargo sempre; preferência, carga, horas não trabalhadas, CTPS e seção só se a planilha trouxer valor). Ninguém é apagado.
        </p>
      </section>

      {erro && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-critico/40 bg-critico/5 p-3.5 text-sm text-critico">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {erro}
        </p>
      )}

      {resultado && (
        <section className="space-y-5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-lg font-semibold">{resultado.simulado ? "Resultado da validação" : "Importação concluída"}</h2>
            <Badge variant="secondary">{resultado.formato === "quadro" ? "Quadro de horário" : "Planilha modelo"}</Badge>
            {resultado.simulado ? (
              <Badge variant="outline">Nada foi gravado</Badge>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-ok">
                <CheckCircle2 className="size-4" aria-hidden /> Gravado
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Contagem rotulo="Lidas" valor={resultado.lidas} />
            <Contagem rotulo={resultado.simulado ? "Seriam novas" : "Novas"} valor={resultado.novas} />
            <Contagem rotulo={resultado.simulado ? "Seriam atualizadas" : "Atualizadas"} valor={resultado.atualizadas} />
            <Contagem rotulo="Rejeitadas" valor={resultado.rejeitadas.length} destaque="critico" />
          </div>
          {resultado.ausenciasGravadas > 0 && (
            <p className="text-sm text-texto-suave">
              <span className="numero font-mono">{resultado.ausenciasGravadas}</span> {resultado.ausenciasGravadas === 1 ? "ausência" : "ausências"}{" "}
              {resultado.simulado ? "serão registradas" : "registradas"}; as ausências anteriores de quem aparece na aba são substituídas.
            </p>
          )}

          {resultado.avisos.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="font-display text-sm font-semibold">Avisos</h3>
              <ul className="space-y-1.5">
                {resultado.avisos.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-atencao" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resultado.rejeitadas.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-sm font-semibold">Linhas rejeitadas</h3>
              <div className="overflow-x-auto rounded-lg border border-borda bg-superficie">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Aba</TableHead>
                      <TableHead className="text-right">Linha</TableHead>
                      <TableHead>Matrícula</TableHead>
                      <TableHead>Erros</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.rejeitadas.map((r, i) => (
                      <TableRow key={`${r.aba}-${r.linha}-${i}`}>
                        <TableCell>{r.aba}</TableCell>
                        <TableCell className="numero text-right font-mono">{r.linha}</TableCell>
                        <TableCell className="numero font-mono">{r.matricula ?? "—"}</TableCell>
                        <TableCell className="whitespace-normal">
                          <ul className="list-inside list-disc">
                            {r.erros.map((e, j) => (
                              <li key={j}>{e}</li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {!resultado.simulado && (
            <Button asChild>
              <Link href={`/clientes/${clienteId}/funcionarios`}>Ver funcionários</Link>
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
