"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Folder, FolderOpen, FolderPlus, Plus } from "lucide-react";
import { nomeMes } from "@/lib/datas";
import { cn } from "@/lib/utils";
import { proximoAnoACriar } from "./proximoAno";

type Props = {
  clienteId: string;
  meses: { ano: number; mes: number }[];
  hoje: { ano: number; mes: number };
  aoNavegar?: () => void;
};

/**
 * Árvore de escalas: cada ano é uma pasta (do mais antigo para o mais novo) que abre e
 * fecha; dentro, os meses gerados em ordem e um atalho para gerar o próximo mês. No fim da
 * árvore, quando o último ano entra nos meses finais, um botão cria a escala do ano seguinte.
 */
export function AnosEMeses({ clienteId, meses, hoje, aoNavegar }: Props) {
  const caminho = usePathname();
  const aberto = /\/escala\/(\d{4})\/(\d{1,2})$/.exec(caminho);
  const abertoAno = aberto ? Number(aberto[1]) : null;
  const abertoMes = aberto ? Number(aberto[2]) : null;

  const geradosPorAno = new Map<number, number[]>();
  for (const { ano, mes } of meses) geradosPorAno.set(ano, [...(geradosPorAno.get(ano) ?? []), mes]);
  const anos = [...new Set([...geradosPorAno.keys(), hoje.ano])].sort((a, b) => a - b);
  const proximoAno = proximoAnoACriar(meses, hoje);

  // Abertos por padrão: o ano da rota e o ano atual.
  const [fechados, setFechados] = useState<Set<number>>(new Set());
  const estaAberto = (ano: number) => !fechados.has(ano);
  const alternar = (ano: number) =>
    setFechados((atual) => {
      const novo = new Set(atual);
      if (novo.has(ano)) novo.delete(ano);
      else novo.add(ano);
      return novo;
    });

  return (
    <nav aria-label="Escalas por ano" className="flex flex-col gap-1">
      {anos.map((ano) => {
        const gerados = [...(geradosPorAno.get(ano) ?? [])].sort((a, b) => a - b);
        const abertoAqui = estaAberto(ano) || abertoAno === ano;
        const anoAtivo = abertoAno === ano;
        // Próximo mês sem escala: depois do último gerado, ou o mês atual se o ano está vazio.
        const ultimo = gerados[gerados.length - 1];
        const proximo = ultimo !== undefined ? (ultimo < 12 ? ultimo + 1 : null) : ano === hoje.ano ? hoje.mes : 1;
        const hrefDe = (mes: number) => `/clientes/${clienteId}/escala/${ano}/${mes}`;
        const Icone = abertoAqui ? FolderOpen : Folder;
        return (
          <div key={ano}>
            <button
              type="button"
              onClick={() => alternar(ano)}
              aria-expanded={abertoAqui}
              aria-controls={`meses-${ano}`}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-acento focus-visible:outline-none",
                anoAtivo ? "text-texto" : "text-texto-suave hover:text-texto",
              )}
            >
              <ChevronRight
                className={cn("size-3.5 shrink-0 transition-transform", abertoAqui && "rotate-90")}
                aria-hidden
              />
              <Icone className={cn("size-4 shrink-0", anoAtivo && "text-acento")} aria-hidden />
              <span className="flex-1 font-mono tracking-wide">{ano}</span>
              <span className="text-[0.7rem] text-texto-suave">
                {gerados.length} {gerados.length === 1 ? "mês" : "meses"}
              </span>
            </button>
            {abertoAqui && (
              <ul id={`meses-${ano}`} className="ml-4 flex flex-col gap-0.5 border-l border-borda pl-2">
                {gerados.map((mes) => {
                  const ativo = anoAtivo && abertoMes === mes;
                  const corrente = ano === hoje.ano && mes === hoje.mes;
                  return (
                    <li key={mes}>
                      <Link
                        href={hrefDe(mes)}
                        onClick={aoNavegar}
                        aria-current={ativo ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm capitalize transition-colors",
                          ativo ? "bg-acento/12 font-medium text-acento" : "text-texto-suave hover:bg-accent hover:text-texto",
                        )}
                      >
                        <span className="flex-1">{nomeMes(mes)}</span>
                        {corrente && <span className="text-[0.7rem] font-medium normal-case text-acento">hoje</span>}
                      </Link>
                    </li>
                  );
                })}
                {proximo !== null && (
                  <li>
                    <Link
                      href={hrefDe(proximo)}
                      onClick={aoNavegar}
                      aria-current={anoAtivo && abertoMes === proximo ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm capitalize transition-colors",
                        anoAtivo && abertoMes === proximo
                          ? "bg-acento/12 font-medium text-acento"
                          : "text-texto-suave/80 hover:bg-accent hover:text-texto",
                      )}
                    >
                      <Plus className="size-3.5 shrink-0" aria-hidden />
                      <span className="flex-1">Gerar {nomeMes(proximo)}</span>
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
      {proximoAno !== null && (
        <Link
          href={`/clientes/${clienteId}/escala/${proximoAno}/1`}
          onClick={aoNavegar}
          aria-current={abertoAno === proximoAno ? "page" : undefined}
          className={cn(
            "mt-1 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-acento focus-visible:outline-none",
            abertoAno === proximoAno
              ? "border-acento/50 bg-acento/12 text-acento"
              : "border-borda text-texto-suave hover:bg-accent hover:text-texto",
          )}
        >
          <FolderPlus className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            Criar escala de <span className="font-mono tracking-wide">{proximoAno}</span>
          </span>
        </Link>
      )}
    </nav>
  );
}
