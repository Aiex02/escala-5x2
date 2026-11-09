import { PrismaClient, type Periodo } from "@prisma/client";

const prisma = new PrismaClient();

const TODOS_OS_DIAS = 127; // bits 0..6

const funcionarios: {
  nome: string;
  cargo: string;
  preferencia: Periodo | null;
}[] = [
  { nome: "Marina Albuquerque", cargo: "Atendente", preferencia: "MANHA" },
  { nome: "Rafael Bittencourt", cargo: "Atendente", preferencia: "TARDE" },
  { nome: "Juliana Carvalhais", cargo: "Atendente", preferencia: null },
  { nome: "Thiago Domingues", cargo: "Atendente", preferencia: "MANHA" },
  { nome: "Larissa Esteves", cargo: "Atendente", preferencia: "TARDE" },
  { nome: "Bruno Figueiredo", cargo: "Barista", preferencia: "MANHA" },
  { nome: "Camila Guimarães", cargo: "Barista", preferencia: null },
  { nome: "Diego Holanda", cargo: "Barista", preferencia: "TARDE" },
  { nome: "Patrícia Ibiapina", cargo: "Cozinheiro", preferencia: "MANHA" },
  { nome: "Otávio Jardim", cargo: "Cozinheiro", preferencia: "TARDE" },
];

async function main() {
  await prisma.cliente.deleteMany();

  await prisma.cliente.create({
    data: {
      nome: "Cafeteria do Shopping",
      regras: {
        create: {
          cargaSemanalMaxMin: 2640,
          jornadaDiariaMaxMin: 480,
          descansoEntreJornadasMin: 660,
          maxDiasConsecutivos: 6,
          inicioSemana: "SEGUNDA",
          folgasSemanaisMin: 1,
          domingosSeguidosMax: 2,
          regime: "EC141",
          ec141Publicacao: new Date(Date.UTC(2026, 9, 16)),
          jornadaPadraoMin: 360,
          intervaloPadraoMin: 15,
          modelo: "shopping",
        },
      },
      janelas: {
        create: Array.from({ length: 7 }, (_, dia) => ({
          dia,
          abreMin: 600,
          fechaMin: 1320,
        })),
      },
      turnos: {
        create: [
          {
            nome: "Manhã",
            inicioMin: 600,
            fimMin: 975,
            intervaloMin: 15,
            efetivoMinimo: 1,
            ordem: 0,
            cor: "#E3B341",
            diasSemana: TODOS_OS_DIAS,
          },
          {
            nome: "Tarde",
            inicioMin: 945,
            fimMin: 1320,
            intervaloMin: 15,
            efetivoMinimo: 1,
            ordem: 1,
            cor: "#E8794A",
            diasSemana: TODOS_OS_DIAS,
          },
        ],
      },
      funcionarios: {
        create: funcionarios.map((f, i) => ({
          matricula: String(1001 + i),
          nome: f.nome,
          cargo: f.cargo,
          preferencia: f.preferencia,
        })),
      },
    },
  });

  console.log("Seed concluído: 1 cliente, 2 turnos, 10 funcionários.");
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
