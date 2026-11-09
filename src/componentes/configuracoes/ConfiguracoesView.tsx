"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/componentes/ui/tabs";
import type { ConfiguracaoDto } from "@/servicos/dto";
import { SecaoFuncionamento } from "./SecaoFuncionamento";
import { SecaoHoraExtra } from "./SecaoHoraExtra";
import { SecaoFuncoes } from "./SecaoFuncoes";
import { SecaoPerigo } from "./SecaoPerigo";
import { SecaoRegime } from "./SecaoRegime";
import { SecaoTurnos } from "./SecaoTurnos";

export function ConfiguracoesView({ config, abaInicial = "funcionamento" }: { config: ConfiguracaoDto; abaInicial?: string }) {
  // Chaves que recriam a seção quando os dados do servidor mudam (os formulários guardam rascunho local).
  const chaveFuncionamento = JSON.stringify([config.modelo, config.regras, config.janelas, config.jornadaMin, config.intervaloMin]);
  const chaveRegime = `${config.regime}|${config.publicacao}`;
  const chaveHoraExtra = `${config.permitirHoraExtra}|${config.horaExtraDiariaMaxMin}`;
  const chaveFuncoes = JSON.stringify([config.funcoes.map((f) => [f.chave, f.nome, f.pessoas]), config.turnos.map((t) => t.diasSemana), config.regime, config.publicacao, config.regras]);

  return (
    <Tabs defaultValue={abaInicial} className="gap-5">
      <div className="overflow-x-auto">
        <TabsList variant="line">
          <TabsTrigger value="funcionamento">Funcionamento e jornada</TabsTrigger>
          <TabsTrigger value="turnos">Turnos</TabsTrigger>
          <TabsTrigger value="regime">Fim da escala 6x1</TabsTrigger>
          <TabsTrigger value="funcoes">Funções por turno</TabsTrigger>
          <TabsTrigger value="horaExtra">Cobertura e hora extra</TabsTrigger>
          <TabsTrigger value="perigo">Zona de perigo</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="funcionamento">
        <SecaoFuncionamento key={chaveFuncionamento} config={config} />
      </TabsContent>
      <TabsContent value="turnos">
        <SecaoTurnos clienteId={config.clienteId} turnos={config.turnos} />
      </TabsContent>
      <TabsContent value="regime">
        <SecaoRegime key={chaveRegime} config={config} />
      </TabsContent>
      <TabsContent value="funcoes">
        <SecaoFuncoes key={chaveFuncoes} config={config} />
      </TabsContent>
      <TabsContent value="horaExtra">
        <SecaoHoraExtra key={chaveHoraExtra} config={config} />
      </TabsContent>
      <TabsContent value="perigo">
        <SecaoPerigo clienteId={config.clienteId} nome={config.nome} />
      </TabsContent>
    </Tabs>
  );
}
