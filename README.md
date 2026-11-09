# Escalas

Organizador de escalas de trabalho. Gera a escala mensal de cada cliente respeitando a lei
(EC 141/2026, fim da escala 6x1) e as regras da empresa, importa funcionários e quadros de horário
por Excel e exporta o resultado. Todo o domínio, a interface e as mensagens estão em português do Brasil.

## Stack

- Next.js 16 (App Router, Cache Components) + React 19 + TypeScript estrito
- Tailwind CSS v4 + shadcn/ui (`src/componentes/ui`) + lucide-react
- Prisma 6 + PostgreSQL (local com Docker; Supabase em produção)
- exceljs (importação/exportação), zod (validação), vitest (testes)

## Como rodar

```bash
npm install
cp .env.example .env            # já aponta para o Postgres do docker
# preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no .env (Supabase Auth)
docker compose up -d            # Postgres 16 na porta 54329
npx prisma migrate dev          # aplica as migrações
npm run db:seed                 # cliente de exemplo "Cafeteria do Shopping"
npm run dev                     # http://localhost:3000
```

Outros comandos: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Login

A autenticação usa o Supabase Auth (e-mail e senha). Não há cadastro público: os usuários são criados
no painel do Supabase, em *Authentication > Users > Add user*, marcando *Auto Confirm User*.

Todas as rotas, inclusive `/api`, exigem login, controlado por `src/proxy.ts`. `/login` é a única rota pública.

## Banco de dados: local no Docker, produção no Supabase

Em desenvolvimento o banco é o Postgres do `docker-compose.yml` (porta 54329), como no passo a passo acima.
Só o Auth vai sempre ao Supabase. Em produção, banco e Auth ficam no mesmo projeto Supabase:

1. No painel do Supabase, em *Connect*, copie as duas strings de conexão e preencha as variáveis do ambiente de deploy:
   - `DATABASE_URL`: *Transaction pooler*, porta 6543, com `?pgbouncer=true` (em serverless, acrescente `&connection_limit=1`).
   - `DIRECT_URL`: *Session pooler* ou conexão direta, porta 5432 (usada só pelas migrações).
2. Aplique as migrações: `npx prisma migrate deploy` (com `DIRECT_URL` apontando para o Supabase).
3. As variáveis do Auth (`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) vêm de *Project Settings > API Keys*.
4. **Segurança:** as tabelas criadas pelo Prisma ficam no schema `public` sem RLS, e a chave publicável é pública
   (vai ao navegador). Desligue a *Data API* do projeto (*Project Settings > Data API*), já que o app só acessa o
   banco pelo Prisma; caso contrário, qualquer pessoa com a chave lê e grava nas tabelas pela REST do Supabase.

## Estrutura de pastas

```
prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
docker-compose.yml                 Postgres 16 local para desenvolvimento (porta 54329)
.env.example                       Auth do Supabase + DATABASE_URL / DIRECT_URL (local e Supabase)
src/
  proxy.ts                         protege as rotas e renova a sessão do Supabase
  app/                             App Router
    login/page.tsx                 tela de login (única rota pública)
    layout.tsx                     fontes, tema, Toaster
    page.tsx                       redireciona ao primeiro cliente ou ao onboarding
    clientes/novo/page.tsx         criar cliente
    clientes/[clienteId]/layout.tsx  sidebar (clientes, navegação, meses gerados)
    clientes/[clienteId]/escala/[ano]/[mes]/page.tsx   Quadro + abas Mês/Semana
    clientes/[clienteId]/funcionarios/page.tsx
    clientes/[clienteId]/importar/page.tsx
    clientes/[clienteId]/configuracoes/page.tsx
  motor/                           domínio puro (sem prisma/next/react): regras, saldo, geração, verificação
  excel/                           leitura/validação de xlsx e exportação (sem prisma)
  servicos/                        casos de uso: prisma + motor + excel
  acoes/                           Server Actions finas (zod, serviços, revalidatePath); autenticacao.ts (entrar/sair)
  componentes/
    ui/                            shadcn/ui
    shell/                         Sidebar, SeletorCliente, ArvoreMeses, Cabecalho, AlternadorTema
    escala/ funcionarios/ importacao/ configuracoes/ autenticacao/
  lib/                             db.ts, datas.ts, formato.ts, resultado.ts, utils.ts, env.ts
    supabase/                      cliente Supabase do servidor, usuário autenticado
    autenticacao/                  regras de acesso por rota (puras, testadas)
```

## Convenções

- Datas do domínio são strings `AAAA-MM-DD`; horas são minutos do dia; durações em minutos.
- Colunas `@db.Date` do Prisma usam `Date` UTC à meia-noite: converta com `paraISO`/`deISO` (`src/lib/datas.ts`).
- Server Actions devolvem `Resultado<T>` (`src/lib/resultado.ts`) e nunca lançam erro ao cliente.
