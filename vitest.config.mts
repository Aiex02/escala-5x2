import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `root` é "src", e não a raiz do projeto, de propósito: no Vitest 5.0.5, quando `node_modules`
// fica dentro do root, o próprio pacote `vitest` passa pelo transformador do Vite e o módulo do
// runner é carregado duas vezes — aí todo arquivo de teste falha já no `describe`, com
// "Cannot read properties of undefined (reading 'config')". Com o root em "src", `node_modules`
// fica fora dele e o runner é carregado uma única vez.
export default defineConfig({
  root: fileURLToPath(new URL("./src", import.meta.url)),
  // Sem isto o cache do Vite nasceria em src/node_modules/.vite, dentro do código-fonte.
  cacheDir: fileURLToPath(new URL("./node_modules/.vite", import.meta.url)),
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // A simulação de três anos do motor e a da farmácia 24h levam mais que o padrão de 5s.
    testTimeout: 60_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
