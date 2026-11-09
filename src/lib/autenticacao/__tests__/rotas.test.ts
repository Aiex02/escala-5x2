import { describe, expect, it } from "vitest";
import { decidirAcesso, destinoSeguro } from "../rotas";

describe("decidirAcesso", () => {
  it("bloqueia /api sem login", () => {
    expect(decidirAcesso("/api/x", false)).toEqual({ tipo: "naoAutorizado" });
  });
  it("redireciona ao login guardando o destino", () => {
    expect(decidirAcesso("/clientes/a", false, "?m=1")).toEqual({
      tipo: "redirecionar",
      destino: `/login?proximo=${encodeURIComponent("/clientes/a?m=1")}`,
    });
  });
  it("omite proximo na raiz", () => {
    expect(decidirAcesso("/", false)).toEqual({ tipo: "redirecionar", destino: "/login" });
  });
  it("segue em /login sem login", () => {
    expect(decidirAcesso("/login", false)).toEqual({ tipo: "seguir" });
  });
  it("autenticado em /login volta para a raiz", () => {
    expect(decidirAcesso("/login", true)).toEqual({ tipo: "redirecionar", destino: "/" });
  });
  it("autenticado segue nas demais rotas", () => {
    expect(decidirAcesso("/clientes/a", true)).toEqual({ tipo: "seguir" });
    expect(decidirAcesso("/api/x", true)).toEqual({ tipo: "seguir" });
  });
});

describe("destinoSeguro", () => {
  it("aceita caminho interno", () => {
    expect(destinoSeguro("/clientes/x")).toBe("/clientes/x");
  });
  it("rejeita destinos externos ou vazios", () => {
    expect(destinoSeguro("//evil.com")).toBe("/");
    expect(destinoSeguro("https://x")).toBe("/");
    expect(destinoSeguro("")).toBe("/");
    expect(destinoSeguro(null)).toBe("/");
    expect(destinoSeguro(undefined)).toBe("/");
  });
});
