import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/componentes/ui/sonner";
import { TooltipProvider } from "@/componentes/ui/tooltip";
import "./globals.css";

const fonteDisplay = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const fonteCorpo = Figtree({
  variable: "--font-corpo",
  subsets: ["latin"],
  display: "swap",
});

const fonteMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Escalas",
  description: "Organizador de escalas de trabalho",
};

/** Aplica o tema salvo antes da primeira pintura, evitando o flash de tema errado. */
const scriptTema = `(function(){try{var t=localStorage.getItem("tema")||"sistema";var e=t==="escuro"||(t==="sistema"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",e);}catch(_){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${fonteDisplay.variable} ${fonteCorpo.variable} ${fonteMono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTema }} />
      </head>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
