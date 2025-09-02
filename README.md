# Fastify Scalar Plugin
![alt text](https://badge.fury.io/js/fastify-scalar-plugin.svg)

![alt text](https://img.shields.io/badge/License-MIT-yellow.svg)

Um plugin para Fastify que gera automaticamente uma documentação de API interativa e elegante usando a UI do Scalar.

Este plugin inspeciona suas rotas, extrai os schemas definidos com Zod e gera uma especificação OpenAPI 3.0 para alimentar a interface do Scalar, tudo isso sem esforço e com configuração mínima.

![alt text](https://raw.githubusercontent.com/scalar/scalar/main/packages/api-reference/public/images/social.png)

✨ Destaques
Geração Automática: Cria a documentação da sua API a partir dos seus schemas Zod existentes.

Integração Perfeita: Funciona de forma nativa com fastify-type-provider-zod.

UI Moderna: Utiliza a interface do Scalar, que é rápida, responsiva e bonita.

Totalmente Tipado: Desenvolvido com TypeScript para uma melhor experiência de desenvolvimento.

Configurável: Permite customizar tanto as informações da API (título, versão) quanto a aparência do Scalar (tema, layout).

🚀 Instalação
Você precisará ter o fastify e o zod como dependências no seu projeto.


´´´bash
# Usando npm
npm install fastify-scalar-plugin fastify-type-provider-zod zod

# Usando yarn
yarn add fastify-scalar-plugin fastify-type-provider-zod zod

# Usando pnpm
pnpm add fastify-scalar-plugin fastify-type-provider-zod zod

# Usando bun
bun add fastify-scalar-plugin fastify-type-provider-zod zod
```


📚 Exemplo de Uso
O exemplo abaixo demonstra como configurar um servidor Fastify com validação Zod e registrar o plugin para gerar a documentação.

Pré-requisitos: Certifique-se de que seu projeto está configurado para usar o fastify-type-provider-zod.

```typescript
// server.ts

import { fastify } from "fastify";
import fastifyScalar from "fastify-scalar-plugin"; // Importe o seu plugin aqui
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

// --- 1. Configuração Inicial do Servidor Fastify ---
const app = fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);


// --- 2. Registro do Plugin fastify-scalar-plugin ---
app.register(fastifyScalar, {
  // 👇 MUDANÇA PRINCIPAL AQUI 👇
  // Para servir na rota raiz (index), basta definir o prefixo como "/".
  // A documentação agora será acessível em http://localhost:3000
  routePrefix: "/",

  openapi: {
    info: {
      title: "API de Usuários",
      version: "1.0.0",
      description: "Uma API de exemplo para gerenciar usuários.",
    },
    servers: [{ url: "http://localhost:3000", description: "Servidor de desenvolvimento" }],
  },
  scalarOptions: {
    theme: "purple",
    layout: "modern",
  },
});


// --- 3. Definição dos Schemas com Zod ---
const UserSchema = z.object({
  id: z.number().describe("ID único do usuário"),
  name: z.string().min(1).describe("Nome completo do usuário"),
  email: z.string().email().describe("Endereço de e-mail válido"),
  createdAt: z.string().datetime().describe("Data e hora de criação do registro"),
});

const CreateUserSchema = UserSchema.omit({ id: true, createdAt: true });

const ErrorSchema = z.object({
  error: z.string().describe("Mensagem descritiva do erro"),
  code: z.number().int().describe("Código de erro interno"),
});


// --- 4. Banco de Dados Falso (Mock) ---
const users = [
  { id: 1, name: "João Silva", email: "joao@example.com", createdAt: new Date().toISOString() },
  { id: 2, name: "Maria Santos", email: "maria@example.com", createdAt: new Date().toISOString() },
];


// --- 5. Definição das Rotas da API ---

app.get(
  "/users",
  {
    schema: {
      tags: ["Usuários"],
      summary: "Listar todos os usuários",
      description: "Retorna uma lista paginada de usuários.",
      querystring: z.object({
        page: z.number().min(1).default(1).describe("Número da página"),
        limit: z.number().min(1).max(100).default(10).describe("Itens por página"),
        search: z.string().optional().describe("Termo de busca por nome ou email"),
      }),
      response: {
        200: z.object({
          users: z.array(UserSchema).describe("A lista de usuários da página atual"),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        }).describe("Resposta de sucesso com a lista de usuários e dados de paginação"),
        400: ErrorSchema,
      },
    },
  },
  async (request, reply) => {
    const { page, limit, search } = request.query;
    let filteredUsers = users;
    if (search) {
      filteredUsers = users.filter(
        (user) =>
          user.name.toLowerCase().includes(search.toLowerCase()) ||
          user.email.toLowerCase().includes(search.toLowerCase())
      );
    }
    return {
      users: filteredUsers.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: filteredUsers.length },
    };
  }
);

app.put(
  "/users/:id",
  {
    schema: {
      tags: ["Usuários"],
      summary: "Atualizar um usuário",
      params: z.object({
        id: z.coerce.number().describe("ID do usuário a ser atualizado"),
      }),
      body: CreateUserSchema,
      response: {
        200: UserSchema.describe("O usuário atualizado com sucesso"),
        404: ErrorSchema.describe("O usuário com o ID especificado não foi encontrado"),
        400: ErrorSchema,
      },
    },
  },
  async (request, reply) => {
    const { id } = request.params;
    const userData = request.body;
    const userIndex = users.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      reply.code(404);
      return { error: "Usuário não encontrado", code: 404 };
    }
    users[userIndex] = { ...users[userIndex], ...userData };
    return users[userIndex];
  }
);


// --- 6. Inicialização do Servidor ---
const start = async () => {
  try {
    await app.listen({ port: 3000 });
    // Agora, a mensagem principal é a raiz da aplicação.
    app.log.info(`🚀 Servidor rodando. Documentação disponível em http://localhost:3000`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
```

| Opção           | Tipo     | Padrão      | Descrição                                                                                                                                                                 |
| :-------------- | :------- | :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routePrefix`   | `string` | `"/docs"`   | A URL onde a documentação será exposta. Use `"/"` para servir na raiz do site.                                                                                              |
| `openapi`       | `object` | `{...}`     | Um objeto contendo as informações da especificação OpenAPI, como `info`, `servers`, `tags`, etc.                                                                            |
| `openapi.info`  | `object` | `{...}`     | Contém o `title`, `version` e `description` da sua API.                                                                                                                   |
| `openapi.servers`| `array`  | `[]`        | Uma lista de objetos de servidor, cada um com `url` e `description`.                                                                                                      |
| `scalarOptions` | `object` | `{}`        | Um objeto com opções para customizar a UI do Scalar.


🤝 Contribuição
Contribuições são bem-vindas! Sinta-se à vontade para abrir uma issue para relatar bugs ou sugerir novas funcionalidades. Pull requests também são muito bem-vindos.

📄 Licença
Este projeto é licenciado sob a Licença MIT.