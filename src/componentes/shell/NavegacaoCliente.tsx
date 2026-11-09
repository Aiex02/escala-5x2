"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileUp, Settings, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  clienteId: string;
  aoNavegar?: () => void;
};

export function NavegacaoCliente({ clienteId, aoNavegar }: Props) {
  const caminho = usePathname();
  const base = `/clientes/${clienteId}`;

  const itens: { rotulo: string; href: string; prefixo: string; Icone: LucideIcon }[] = [
    { rotulo: "Funcionários", href: `${base}/funcionarios`, prefixo: `${base}/funcionarios`, Icone: Users },
    { rotulo: "Importar", href: `${base}/importar`, prefixo: `${base}/importar`, Icone: FileUp },
    { rotulo: "Configurações", href: `${base}/configuracoes`, prefixo: `${base}/configuracoes`, Icone: Settings },
  ];

  return (
    <nav aria-label="Navegação do cliente" className="flex flex-col gap-0.5">
      {itens.map(({ rotulo, href, prefixo, Icone }) => {
        const ativo = caminho === prefixo || caminho.startsWith(`${prefixo}/`);
        return (
          <Link
            key={rotulo}
            href={href}
            onClick={aoNavegar}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
              ativo
                ? "bg-acento/12 text-acento"
                : "text-texto-suave hover:bg-accent hover:text-texto",
            )}
          >
            <Icone className="size-4" aria-hidden />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
