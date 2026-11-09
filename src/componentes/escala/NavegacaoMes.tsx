import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/componentes/ui/button";
import { nomeMes } from "@/lib/datas";
import { cn } from "@/lib/utils";

function vizinho(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) + delta;
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 };
}

/** Setas para o mês anterior e o seguinte. */
export function NavegacaoMes({ clienteId, ano, mes }: { clienteId: string; ano: number; mes: number }) {
  const a = vizinho(ano, mes, -1);
  const s = vizinho(ano, mes, 1);
  const href = (m: { ano: number; mes: number }) => `/clientes/${clienteId}/escala/${m.ano}/${m.mes}`;
  return (
    <nav aria-label="Navegação entre meses" className="flex items-center">
      <Link href={href(a)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }))} aria-label={`Mês anterior: ${nomeMes(a.mes)} de ${a.ano}`}>
        <ChevronLeft aria-hidden />
      </Link>
      <Link href={href(s)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }))} aria-label={`Próximo mês: ${nomeMes(s.mes)} de ${s.ano}`}>
        <ChevronRight aria-hidden />
      </Link>
    </nav>
  );
}
