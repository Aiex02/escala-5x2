"use client"

import { useSyncExternalStore } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** Observa a classe `dark` do <html> (controlada por AlternadorTema). */
function assinarTema(aoMudar: () => void) {
  const observador = new MutationObserver(aoMudar)
  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observador.disconnect()
}

const lerTema = () =>
  document.documentElement.classList.contains("dark") ? "dark" : "light"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSyncExternalStore<ToasterProps["theme"]>(assinarTema, lerTema, () => "light")

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
