# Organizador de Escalas

App desktop (Tauri 2) para organizar escalas de trabalho por cliente: cadastro de clientes,
importação de funcionários via Excel, agenda mensal agrupada por turno e geração automática
de escalas que **nunca ultrapassam a carga semanal configurada** (sem hora extra).

---

## Funcionamento, turnos e preferências

A escala parte do **horário em que o estabelecimento funciona**, não do horário de cada pessoa:

- Em **Configurações → Funcionamento e jornada**, escolha um **modelo**. O modelo define tudo
  junto: dias e horários, jornada e intervalo dos funcionários e as regras de jornada do fim
  da escala 6x1 (regime da EC 141). Com um modelo, os campos ficam travados e a tela mostra as
  fases da lei e as horas por semana em cada uma. Só em **Personalizado** dá para mexer nos
  horários, na jornada e nas cargas; cada valor fora da lei ou da CLT gera um aviso (carga
  acima de 44h, mais de 8h por dia, menos de 11h entre jornadas, sem folga semanal, mais de
  6 dias seguidos, sem o regime da EC 141, intervalo fora da CLT, domingos no comércio). O
  mesmo modelo é escolhido ao criar o cliente. O app gera os
  turnos intercalados que cobrem o horário aberto: o primeiro começa na abertura, o último
  termina no fechamento e os do meio ficam espaçados por igual (múltiplos de 15 min).
  - Loja de shopping, todos os dias das 10h às 22h, jornada de 6h + 15 min: **Manhã
    10:00–16:15** e **Tarde 15:45–22:00** (30 min de troca com as duas equipes).
  - Das 9h às 22h: três turnos, 09:00, 12:15 e 15:45.
  - Dia com horário menor (domingo das 14h às 20h) ganha turno próprio. Se esse turno tem
    menos horas que a jornada (domingo das 8h às 14h com jornada de 8h), quem o fizer fica
    abaixo das horas previstas da semana; como a escala não tira horas de ninguém, esse dia
    fica sem cobertura e a agenda avisa. A tela de funcionamento alerta antes de salvar.
- Modelos prontos, definidos no backend (`crates/escala-app/src/modelos.rs`). Todos usam o
  regime da EC 141 (44h e 1 folga até 15/12/2026; 42h e 2 folgas a partir de 16/12/2026; 40h e
  2 folgas a partir de 16/12/2027), 8h por dia no máximo, 11h entre jornadas e folga até o 7º
  dia, e cabem nas 40h com 2 folgas da regra final, com o intervalo da CLT:

  | Modelo | Funcionamento | Jornada | Turnos | Domingos seguidos |
  |---|---|---|---|---|
  | Shopping (padrão) | todos os dias 10:00–22:00 | 6h + 15 min | 10:00–16:15, 15:45–22:00 | até 2 |
  | Shopping com domingo reduzido | seg–sáb 10:00–22:00, dom 14:00–20:15 | 6h + 15 min | os dois acima seg–sáb; 14:00–20:15 no domingo | até 2 |
  | Comércio / varejo | seg–sáb 09:00–19:00 | 8h + 1h | 09:00–18:00, 10:00–19:00 | — (fecha) |
  | Supermercado | todos os dias 07:00–22:00 | 8h + 1h | 07:00–16:00, 13:00–22:00 | até 2 |
  | Administrativo (CLT) | seg–sex 08:00–17:00 | 8h + 1h | 08:00–17:00 | — (fecha) |
  | Restaurante | ter–dom 11:00–23:00 | 8h + 1h | 11:00–20:00, 14:00–23:00 | até 2 |
  | 24 horas | todos os dias, 24h a partir das 06:00 | 8h + 1h | 06:00–15:00, 13:30–22:30, 21:00–06:00 | até 6 |

  "Até 2 domingos seguidos" segue a Lei 10.101/2000 para o comércio (folga em ao menos um
  domingo a cada três semanas). O motor faz um rodízio escalonado: cada pessoa folga um
  domingo a cada três, em semanas diferentes das colegas do mesmo turno, para que nenhum
  domingo fique vazio.
- Salvar o funcionamento refaz os turnos. Os de mesmo horário continuam (com cor e pessoas
  mínimas); os que deixam de existir são arquivados se aparecem em escalas já geradas (e
  continuam visíveis nelas) ou excluídos.
- O funcionário tem só uma **preferência de período** opcional (manhã, tarde ou noite). Não há
  dias de trabalho nem turnos fixos por pessoa: as folgas e o turno saem da escala.
- **Gerar escala** redistribui todos os funcionários ativos entre os turnos. Cada pessoa fica
  numa faixa do dia (abertura ou fechamento) o mês inteiro, as faixas ficam com o mesmo número
  de pessoas e a preferência é atendida quando há vaga nela. Com 6 pessoas preferindo manhã,
  3 preferindo tarde e 1 sem preferência, ficam 5 e 5: 5 das 6 da manhã na manhã e o resto na
  tarde.
- A agenda abre no **Quadro** (visão principal), com **Mês** e **Semana** ao lado. O Quadro é
  uma planilha editável, uma linha por pessoa e uma coluna por dia: clique numa célula (ou use
  as setas e Enter) para trocar o turno, ou digite `M`, `T`, `N`, `F` (folga), `A` (falta) ou
  `J` (ausência justificada, com motivo opcional). As horas, o saldo e as pessoas por turno em
  cada dia são recalculados na hora. O ajuste é livre: se quebrar uma regra (folgas, descanso,
  limite semanal), a agenda mostra o aviso, sem impedir.

### Ausências e saldo de horas

- **Falta** (ausência não justificada): a pessoa não trabalha e as horas do dia continuam
  previstas, então ela fica devendo.
- **Ausência justificada** (férias, atestado, afastamento): as horas do dia são abonadas e
  saem das horas previstas da semana, sem dívida. As ausências importadas da planilha são
  justificadas, a não ser que a coluna `justificada` diga "não".
- Marcar turno ou folga num dia de férias tira só aquele dia do período.
- **Horas previstas** da semana: jornadas inteiras dentro do limite semanal, das folgas
  obrigatórias e dos dias em que o estabelecimento abre, menos uma jornada por ausência
  justificada nesses dias. O **saldo** é feito − previsto, somado só nas semanas fechadas
  (todos os dias em meses gerados).
- **Compensação**: ao gerar um mês, o saldo dos meses anteriores (e o que sobrar ou faltar em
  cada semana) é compensado dentro das regras, sem hora extra:
  - horas a mais: uma folga a mais na semana (até uma por semana) ou saída mais cedo (até 2h
    numa jornada, nunca abaixo de 4h);
  - horas devidas: um dia a mais, se o limite semanal e as folgas deixarem; se não, jornadas
    mais longas (em passos de 15 min, até a jornada diária máxima e o limite semanal, dentro
    do horário de funcionamento e respeitando o descanso entre jornadas; acima de 6h o
    intervalo passa a 1h). Quem abre fica até mais tarde; quem fecha chega mais cedo.
  - No Quadro, a jornada compensada aparece com uma marca e as colunas **Saldo** (mês) e
    **Acumulado** (anterior + mês) mostram onde cada pessoa está.
  - O que as regras não deixarem compensar segue no saldo para o mês seguinte.
- No quadro real de exemplo (41 pessoas), 3 pessoas com 2 faltas cada (−12h) e 2 com um dia a
  mais (+6h) em fevereiro de 2027 ficaram com saldo acumulado zero ao fim de março, sem
  nenhuma regra quebrada.

Clientes criados em versões anteriores mantêm os turnos que tinham até salvar o funcionamento,
e a tela já mostra o horário que esses turnos cobrem.

### Reequilibrar o mês depois de ajustes

Ajustar o Quadro (trocar turno, dar folga, marcar falta) vale na hora e recalcula horas, saldo
e avisos, mas não mexe nos outros dias. Trocar o turno de duas pessoas no mesmo dia não muda
horas; trocar folga por trabalho deixa uma com horas a mais e outra devendo na semana.

O botão **Reequilibrar** (na agenda) refaz o mês a partir de uma data:
- os dias antes dela e os **dias ajustados à mão** ficam como estão (o Quadro marca esses
  dias);
- o resto do mês é distribuído de novo, compensando o saldo das semanas anteriores dentro das
  regras: quem ficou com horas a mais ganha uma folga ou sai mais cedo; quem ficou devendo
  ganha um dia (se as folgas deixarem) ou jornadas um pouco mais longas, até 8h por dia;
- a opção "Refazer também os meses seguintes já gerados" leva o saldo adiante (cada mês
  seguinte é refeito do dia 1, mantendo os ajustes manuais dele).

Exemplo: em 09/02, A trabalha na folga e B folga no dia de trabalho. Reequilibrando a partir de
10/02, A ganha uma folga e B um dia a mais na mesma semana, e os dois fecham as 30h previstas.
"Gerar de novo" é diferente: refaz o mês do zero e descarta os ajustes manuais.

### Cobertura por função

Cada função (o cargo do funcionário) tem um **mínimo de pessoas por turno**, em todos os dias:
numa cafeteria, por exemplo, pelo menos 1 atendente e 1 cozinheiro em cada turno, nunca 3
atendentes e nenhum cozinheiro.

- Em **Configurações → Funções por turno**, cada função aparece com quantas pessoas ativas tem
  e o mínimo por turno (padrão 1; 0 = sem exigência, para quem não precisa estar em todo
  turno, como um gerente único). A tela avisa quando a função tem gente de menos para cobrir
  todos os turnos da semana: com 2 turnos, 7 dias abertos e 2 folgas, 1 por turno pede ao
  menos 3 pessoas (2 × 7 ÷ 5).
- Cargos escritos de jeitos diferentes contam juntos ("Farmacêutica (o)" e "farmaceutica").
- Ao gerar o mês, o motor:
  1. reserva para cada turno as pessoas da função que a cobertura diária pede (mínimo × 7 ÷ 5,
     ou o que a função tiver), escolhendo primeiro quem prefere aquele período; o resto da
     função segue a preferência;
  2. nos dias apertados (como o domingo do rodízio de domingos), garante a função no início da
     semana, e as folgas se ajeitam em volta;
  3. em cada dia, põe primeiro quem cobre a função e, se ainda faltar, chama alguém da função
     com horas livres na semana (mesmo do outro turno), sem passar de nenhuma regra;
  4. sem ninguém possível, gera o aviso "função descoberta" (um por função, turno e semana,
     com os dias).
- No Quadro, as pessoas aparecem agrupadas por função, e o total do turno no dia fica marcado
  quando falta alguma função ("Falta: Cozinheiro (0 de 1)").

## Fim da escala 6x1 (EC 141/2026)

A Emenda Constitucional 141 (PEC 221/2019), promulgada em 16/10/2026, acaba com a escala 6x1.
O app aplica a regra por data, a partir da publicação (editável em Configurações):

1. **Até 2 meses depois da publicação** (até 15/12/2026): regra anterior da CLT, 44h semanais e
   1 folga por semana.
2. **A partir de 2 meses** (16/12/2026): até **42h** semanais e **2 folgas por semana**, uma
   delas preferencialmente no domingo.
3. **A partir de 14 meses** (16/12/2027): até **40h** semanais e 2 folgas por semana.

Também valem até 8h por dia e o salário não muda. Servidores públicos e empregados com diploma
superior que ganham ao menos R$ 21.188,00 ficam de fora (o app não distingue esses casos).

Como o app aplica:
- Cada cliente tem um **regime legal**: "Fim da escala 6x1 (EC 141/2026)", padrão para clientes
  novos, ou "Só as regras da empresa".
- Em cada semana vale o mais restritivo entre a lei e as regras da empresa: a menor carga e o
  maior número de folgas exigidos em qualquer dia daquela semana. A semana em que a fase muda
  já usa a regra nova inteira.
- O motor nunca escala mais dias do que as folgas permitem. Aos domingos, folga primeiro quem
  trabalhou mais domingos recentes, então o domingo de trabalho roda entre a equipe. Também dá
  para limitar domingos seguidos (no comércio, a Lei 10.101 exige folga em ao menos um domingo
  a cada três semanas: use 2).
- Ao abrir um mês gerado antes de uma mudança de fase, a agenda aponta as semanas que ficaram
  fora da regra; basta gerar o mês de novo.

Fontes: [Senado Notícias](https://www12.senado.leg.br/noticias/videos/2026/10/senado-aprova-pec-que-acaba-com-a-escala-6x1-e-reduz-jornada-para-40-horas),
[Agência Brasil](https://agenciabrasil.ebc.com.br/politica/noticia/2026-10/senado-aprova-fim-da-escala-6x1-e-reducao-da-jornada-de-trabalho).
Confira a data exata de publicação no Diário Oficial e ajuste em Configurações se for diferente.

## Importação de funcionários

A importação traz **só funcionários**: nunca horários ou turnos, que vêm do funcionamento.
Aceita a planilha modelo do app (formato abaixo) ou o **Quadro de Horário de Trabalho** que a
empresa já usa (art. 74 da CLT), inclusive convertido de PDF para Excel. Do quadro são lidos
só os dados das pessoas:

| Coluna do quadro | Uso no app |
|---|---|
| Cód. | Identificação se faltar a CTPS |
| Nome do Funcionário, Nome da Função, Seção | Nome, cargo e seção |
| Número e Série (CTPS) | Identificam a pessoa (matrícula = número da CTPS); reimportar atualiza |
| Ent., Intervalo, Saída, Des | Ignoradas |

- Em **Funcionários**, o lápis abre a edição: função, carga semanal e preferência de período.
  Reimportar não apaga a preferência gravada.
- **CTPS com zeros à esquerda**: quando a planilha guarda o número como valor numérico (caso
  do PDF convertido), o Excel não preserva os zeros (00026631 vira 26631). A identificação
  continua única e estável entre importações.

A escala de cada mês pode ser exportada em Excel (botão **Exportar Excel** na agenda). A
planilha vem pronta para imprimir em A4 paisagem, com uma coluna por dia, os horários e as
folgas, a legenda dos turnos e uma aba com as horas por semana.

## Suposições adotadas

O pedido deixou alguns pontos em aberto. As decisões abaixo são padrões razoáveis e cada uma
indica onde ajustá-la.

| Tema | Suposição | Onde ajustar |
|---|---|---|
| Funcionamento padrão | Todo cliente novo nasce aberto **todos os dias das 10h às 22h**, com jornada de **6h e 15 min de intervalo** (intervalo da CLT para até 6h), o que gera Manhã 10:00–16:15 e Tarde 15:45–22:00, cada uma com no mínimo 1 pessoa por dia. | `funcionamento_padrao()` em `crates/escala-app/src/lib.rs` |
| Geração dos turnos | n = ⌈horas abertas ÷ (jornada + intervalo)⌉ turnos por dia, espaçados por igual e arredondados a 15 min; janelas iguais em dias diferentes viram um turno só. O nome vem do período do início (das 5h às 12h Manhã, até 18h Tarde, depois e de madrugada Noite); abertura igual ao fechamento é 24h; nomes repetidos ganham o horário. Intervalo sugerido: até 4h nenhum, até 6h 15 min, acima 1h. | `gerar_turnos` em `crates/escala-core/src/funcionamento.rs` |
| Dias de funcionamento do turno | Saem do funcionamento. Em dia em que o turno não funciona ninguém é escalado nele, e cota e efetivo mínimo não se aplicam. | `crates/escala-core/src/modelo.rs` |
| Regras padrão | Vêm do modelo (Shopping, se nenhum for escolhido): regime da EC 141 e empresa com 44h semanais, 8h por jornada, 11h de descanso entre jornadas (interjornada da CLT), 1 folga mínima (o regime exige 2 a partir de 16/12/2026), no máximo 6 dias seguidos, semana de segunda a domingo e o limite de domingos do modelo. Clientes de versões anteriores ficam como "Personalizado". | `crates/escala-app/src/modelos.rs` |
| "Sem hora extra" | O limite vale para a **semana completa de apuração**. Nas semanas que atravessam a virada do mês, entram também as horas do mês vizinho já gerado. O limite efetivo de cada funcionário é o menor entre a carga do contrato dele e a regra do cliente. | `crates/escala-core/src/motor.rs` |
| Semanas incompletas | Se parte da semana cai num mês **ainda não gerado**, o mês atual recebe apenas a fração proporcional da carga. O saldo fica para o vizinho, que respeita o que já foi usado. A ordem de geração não importa: dá para gerar meses fora de ordem ou regenerar um mês entre dois já gerados. | `planejar_semana` em `motor.rs` |
| Horas contadas | Conta só o tempo trabalhado: saída − entrada − intervalo. Uma jornada com saída menor ou igual à entrada atravessa a meia-noite. | `crates/escala-core/src/hora.rs` |
| Vínculo funcionário ↔ turno | Todo funcionário ativo pode fazer qualquer turno em uso. A preferência de período decide a faixa quando há vaga; sem preferência, a pessoa completa as faixas com menos gente. Quem estava numa faixa no fim do mês anterior continua nela se ela combina com a preferência. | `atribuir_faixas` em `motor.rs` |
| Ajuste manual | Só em meses gerados. Não respeita as regras à força: o ajuste vale e a agenda aponta a regra quebrada. Gerar o mês de novo desfaz os ajustes (as faltas e ausências marcadas continuam). | `Servico::definir_dia` |
| Saldo anterior | Conta só semanas com todos os dias em meses gerados e em que a pessoa tem jornada ou falta (antes da contratação ou inativa, não há saldo). As horas previstas de cada semana fechada são gravadas ao gerar ou ajustar o mês, então mudar carga, regras ou funcionamento depois não reescreve o saldo antigo (gerar o mês de novo grava o previsto das regras atuais). | `Servico::saldos_anteriores`, tabela `previsto_semanas` |
| Reimportação | A matrícula identifica o funcionário dentro do cliente. Reimportar atualiza nome e cargo; preferência, carga semanal, CTPS e seção só mudam se a planilha trouxer valor (vazio mantém o que foi editado no app). Quem não está na planilha **não** é apagado. As ausências de uma matrícula presente na aba Ausencias são substituídas. | `escala-db::gravar_importacao` |
| Alterar regras depois | Escalas geradas não mudam sozinhas. Ao abrir um mês, a agenda mostra avisos "violação de regra" se as regras atuais não forem mais atendidas, e basta regenerar o mês. | `Servico::obter_agenda` |
| Excluir turno | É recusado se o turno aparece em meses gerados: exclua esses meses antes. | `escala-db::excluir_turno` |
| Feriados | Não são modelados. Feriados e folgas fixas podem ser lançados como ausências. | — |

### Formato da planilha (.xlsx)

A aba **Funcionarios** (ou a primeira aba do arquivo) deve ter o cabeçalho na primeira linha
não vazia. Os nomes das colunas não diferenciam maiúsculas, acentos, espaços nem `_`; os
apelidos aceitos estão em `COLUNAS_FUNCIONARIOS`, em `crates/escala-excel/src/leitura.rs`.

| coluna | obrigatória | formato | exemplo |
|---|---|---|---|
| `matricula` | sim | texto ou número, única na planilha | `1001` |
| `nome` | sim | texto | `Ana Souza` |
| `cargo` | não | texto | `Vigilante` |
| `preferencia` | não | `manhã`, `tarde` ou `noite` (vazio = sem preferência) | `Tarde` |
| `carga_semanal` | não | horas do contrato (`36`, `37,5`, `36h`) | `36` |

Colunas de horário (`turno`, `entrada`, `saida`, `intervalo_min`, `dias_disponiveis`) são
ignoradas, com um aviso.

A aba **Ausencias** é opcional e tem as colunas `matricula` (obrigatória), `inicio`
(obrigatória; data no formato `dd/mm/aaaa`, ISO ou célula de data), `fim` (padrão = `inicio`),
`motivo` e `justificada` (sim/não; vazio = sim).

Cada linha inválida vai para o relatório com a aba, o número da linha no Excel e **todos** os
erros encontrados nela, e as linhas válidas são importadas normalmente. Exemplos de rejeição:
campo obrigatório ausente, preferência inválida, matrícula repetida, número inválido, data
inválida ou fim antes do início, e ausência de uma matrícula que não existe. Já colunas
desconhecidas, colunas de horário e carga acima do limite do cliente geram só avisos. O botão
**Validar** faz uma simulação completa sem gravar nada.

O botão "Baixar planilha modelo" do app gera um modelo. Há também um exemplo pronto, com 15
funcionários, em `exemplos/funcionarios_exemplo.xlsx`.

---

## Stack e justificativa

- **Tauri 2 + Rust**: binário pequeno, sem servidor e com acesso nativo a arquivos. Toda a
  regra de negócio fica em Rust, onde é tipada e testável.
- **React 19 + TypeScript + Vite** no frontend: é o template oficial mais maduro do Tauri,
  tem o maior ecossistema e o TypeScript permite espelhar o contrato com o backend
  (`src/api/types.ts` ↔ `crates/escala-app/src/dto.rs`). Usei CSS puro com variáveis, com
  tema claro e escuro, sem biblioteca de UI.
- **Visual idêntico no macOS e no Windows**: a fonte (IBM Plex Sans variável) vai embutida no
  app, e todos os controles são desenhados pelo próprio app em `src/components/base/`:
  - seleção, combobox com busca, campo de hora com máscara, número com botões −/+;
  - caixa de marcação, interruptor, seletor de cor e de dias da semana;
  - dicas (tooltips) e barras de rolagem próprias.
  Nada usa a aparência nativa do sistema. Os ícones vêm de `lucide-react`.
- **SQLite embutido** (`rusqlite` com `bundled`): compilado dentro do app, transacional,
  com chaves estrangeiras em cascata e migrações versionadas por `PRAGMA user_version`.
- **calamine** para ler `.xlsx` e **rust_xlsxwriter** para gerar o modelo e montar as
  planilhas dos testes.

## Arquitetura

```
organização_5x2/
├── crates/
│   ├── escala-core/    domínio puro + motor de distribuição + verificador (sem IO)
│   ├── escala-excel/   leitura/validação de .xlsx e planilha modelo (sem banco)
│   ├── escala-db/      SQLite: esquema, migrações, repositórios
│   └── escala-app/     casos de uso + DTOs serde (liga as três camadas acima)
├── src-tauri/          casca Tauri: estado, 25 comandos finos, plugin de diálogo
├── src/                interface React
│   ├── api/            contrato (types.ts), cliente (client.ts), backend simulado (mock.ts)
│   ├── components/     telas: sidebar, agenda (mês, semana e quadro), funcionários, importação, configurações
│   │   └── base/       controles próprios (botões, campos, seleção, combobox, hora, cor, dias, dicas)
│   └── util/           datas (UTC), formatação, armazenamento local
└── exemplos/           planilha de exemplo
```

As dependências entre as camadas são:

```
escala-core   →  escala-excel
escala-core   →  escala-db
escala-core
+ escala-excel  →  escala-app  →  src-tauri  →  React (via invoke)
+ escala-db
```

O motor não conhece banco, Excel nem UI. O importador não conhece o banco. Os comandos Tauri
não contêm regra de negócio. Em produção não há `unwrap`, `expect` nem `panic`: os crates usam
`#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` fora dos testes, e os
erros chegam à interface como mensagens em português.

### Como o motor distribui

Primeiro, as **restrições rígidas**, que nunca são violadas: carga semanal (somando os meses
vizinhos), jornada diária, descanso entre jornadas, dias consecutivos, ausências e faltas,
dias de funcionamento do turno e uma jornada por dia.

Depois, a heurística gulosa e determinística (mesma entrada, mesma escala):

1. Antes do mês, cada pessoa recebe uma faixa do dia (0 = turno que abre, 1 = o seguinte...),
   com o mesmo número de pessoas por faixa. Em cada dia, a faixa vira o turno na mesma posição
   entre os turnos daquele dia (num domingo com um turno só, todas as faixas caem nele). Ordem:
   quem mantém a faixa do mês anterior, quem tem preferência de período, os demais.
2. Para cada semana, cada funcionário recebe um alvo: as horas previstas (com as ausências
   justificadas abonadas) menos as já feitas nos meses vizinhos, em jornadas inteiras e
   proporcional quando há dias em aberto no mês vizinho. Nas semanas fechadas, o saldo
   anterior ajusta o alvo em uma jornada: a menos para quem tem horas sobrando, a mais para
   quem deve, se couber.
3. Os dias são percorridos em ordem. Cada turno tem uma cota diária, igual à demanda restante
   dividida pelos dias restantes e nunca menor que o efetivo mínimo. Cota e efetivo mínimo só
   valem nos dias da semana em que o turno funciona, e um dia só conta como possível para o
   funcionário se ele está disponível e ao menos um turno dele funciona nesse dia.
4. Entram primeiro os funcionários com maior pressão (turnos que faltam ÷ dias restantes).
   Quem precisa trabalhar todos os dias que restam é escalado mesmo acima da cota. Isso
   espalha as folgas (5x2) e equilibra a cobertura.
5. Se um turno não atinge o efetivo mínimo, ele é completado com quem ainda tem saldo
   semanal. Quando não há saldo, a escala sai com o aviso "cobertura insuficiente", nunca
   com hora extra.
6. Funções com mínimo por turno: reserva por faixa no início do mês, cobertura nos dias
   apertados no início da semana, prioridade diária e reforço (ver "Cobertura por função").
7. Ao fechar a semana, o que ainda sobra ou falta do saldo vira jornada mais curta ou mais
   longa nos dias daquela semana (ver "Ausências e saldo de horas").

Toda escala gerada ainda passa pelo **verificador independente** (`verificacao.rs`, escrito
sem reaproveitar o motor) antes de ser gravada.

---

## Como executar

Pré-requisitos:

- **Rust 1.90 ou mais novo** (`rustup`).
- **Node 20 ou mais novo** (com npm).
- As dependências de sistema do Tauri para o seu sistema operacional:
  - macOS: Xcode Command Line Tools.
  - Windows: WebView2.
  - Linux: `webkit2gtk-4.1` e as demais bibliotecas listadas em
    https://tauri.app/start/prerequisites/.

```bash
npm install
```

Para abrir o app em modo desenvolvimento, com recarga automática:

```bash
npm run tauri dev
```

Para gerar o instalador (`.app`/`.dmg`, `.msi` ou `.deb`/`.AppImage`) em
`target/release/bundle/`:

```bash
npm run tauri build
```

Para rodar todos os testes Rust (motor, importação, banco, casos de uso e ponte IPC):

```bash
cargo test --workspace
```

Para conferir os tipos do frontend:

```bash
npm run typecheck
```

Para abrir só a interface no navegador, com o backend simulado em memória e sem Tauri:

```bash
npm run dev
```

Para gerar de novo a planilha de exemplo:

```bash
cargo run -p escala-excel --example gerar_exemplo -- exemplos/funcionarios_exemplo.xlsx
```

**Onde ficam os dados**: o banco `escalas.sqlite3` fica na pasta de dados do app.

- macOS: `~/Library/Application Support/br.com.organizador.escalas/`
- Windows: `%APPDATA%\br.com.organizador.escalas\`
- Linux: `~/.local/share/br.com.organizador.escalas/`

Para fazer backup, copie esse arquivo com o app fechado.

### Fluxo de uso

1. Crie um cliente: digite o nome na busca de clientes da barra lateral e escolha
   "Criar cliente", ou use o menu ⋯ ao lado de "Cliente". Escolha o modelo de funcionamento
   (Shopping, Varejo, Administrativo...).
2. Em **Configurações**, confira o funcionamento (modelo, dias, abertura, fechamento,
   jornada) e salve para gerar os turnos; ajuste cor e pessoas mínimas de cada turno se quiser.
3. Em **Importar planilha**, confira e importe os funcionários; em **Funcionários**, ajuste a
   preferência de período de cada um.
4. Clique no ícone de calendário ao lado de "Escalas" para abrir **Nova escala**, escolha ano e
   mês e gere. O mês aparece na árvore de anos; clique nele para abrir a agenda.
5. A agenda abre no **Quadro**; alterne com **Mês** e **Semana**:
   - no quadro, a planilha editável por pessoa e dia (turno, folga, falta, ausência
     justificada), com horas, saldo do mês, acumulado e pessoas por turno;
   - no mês, cada dia mostra quem trabalha em cada turno;
   - na semana, uma linha por turno e uma coluna por dia;
   - abaixo, ficam as horas por semana de cada pessoa (comparadas ao previsto) e os avisos.

## Testes

São 199 testes no total (mais 2 ignorados, que leem um quadro real indicado pela variável `QUADRO_XLSX` e imprimem só contagens).

O arquivo `crates/escala-core/tests/motor.rs` concentra os testes do motor:

- Três anos gerados mês a mês sem nenhuma semana acima de 40h.
- Fevereiro de 2027, que tem só semanas completas: todos chegam a exatamente 40h.
- Cobertura 5x2 estável (5 de 7 pessoas todos os dias).
- Limite configurável (36h) e carga individual (30h).
- Turnos com intervalo e jornadas que não dividem o limite (7h20).
- Mês que começa no meio da semana gerado sozinho e, depois, o mês anterior gerado fora de
  ordem.
- Mês que termina no meio da semana seguido do próximo, que respeita o saldo.
- Mês gerado entre dois meses já gerados, regeneração e semana iniciando no domingo.
- Descanso e dias consecutivos na virada do mês, troca de turno com descanso, ausências e
  disponibilidade.
- Efetivo mínimo impossível, que gera aviso e não gera hora extra.
- Determinismo da geração e entradas inválidas.
- Dias de funcionamento do turno: turno seg–sex sem ninguém no fim de semana e com 40h nas
  semanas completas, semana que termina em dias de turno fechado sem perda de alvo, turno
  seg–sáb com funcionário de dois turnos escalado no domingo só no turno ativo, efetivo
  mínimo sem aviso de cobertura em dia sem funcionamento e turno sem nenhum dia (sem pânico).
- Testes que provam que o verificador detecta violações (inclusive alocação em turno que não
  funciona no dia).
- Um teste de propriedade com 120 configurações aleatórias (regras, turnos com dias de
  funcionamento, contratos, ausências e ordem de geração), sem nenhuma hora extra.

Os demais testes cobrem as outras camadas:

- `crates/escala-excel/tests/importacao.rs`: formatos de célula, 11 tipos de linha rejeitada,
  cabeçalhos com acentos, colunas ausentes, aba de ausências, modelo reimportável e erros de
  arquivo.
- `crates/escala-db/tests/banco.rs`: migração idempotente, migrações da versão 1 até a 5
  (o horário preferido vira preferência de período), funcionamento gravado e lido, turnos
  mantidos, criados, arquivados e excluídos ao aplicar o funcionamento, ajuste manual,
  isolamento por cliente, transações e cascatas.
- `crates/escala-app/tests/fluxo.rs`: fluxo completo de cliente → importação → geração →
  agenda → mudança de regra → regeneração; loja de shopping dividida entre abertura e
  fechamento (5 e 5, preferência atendida quando há vaga); funcionamento com domingo fechado,
  sábado diferente e 24h; ajuste manual no Quadro com horas e avisos recalculados; planilhas
  antigas com `turno`/`entrada` virando preferência.
- `src-tauri/src/lib.rs`: os 25 comandos chamados pela ponte IPC real do Tauri (runtime mock),
  com os mesmos nomes de argumento do frontend.

Testes acrescentados com o fim da escala 6x1:
- Motor: transição de 44h/1 folga para 42h/2 folgas no meio de dezembro/2026, fase final de
  40h, folgas mínimas limitando dias mesmo com horas sobrando, domingos seguidos e rodízio
  de domingos, verificador detectando falta de folga.
- `crates/escala-excel/tests/quadro.rs` (28 testes): leitura do quadro de horário em planilhas
  sintéticas.
- `crates/escala-excel/tests/exportacao.rs` (17 testes): exportação da escala.
- `crates/escala-app/tests/fluxo.rs`: importação de um quadro, diagnóstico, geração de dezembro
  de 2026 na transição e exportação.

## Limitações e próximos passos

- O ajuste manual é feito célula a célula no Quadro; não há arrastar e soltar nem troca de
  plantão entre duas pessoas de uma vez. Gerar o mês de novo desfaz os ajustes.
- A agenda exporta para Excel, não para PDF.
- Feriados e calendário regional não são modelados.
- Não há preferências de folga, como fins de semana alternados.
- O funcionamento é o mesmo toda semana; horários especiais (Natal, Black Friday) entram
  como ajuste manual no Quadro.
