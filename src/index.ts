// fastify-scalar-docs-debug.ts
import type {
  FastifyInstance,
  FastifyPluginAsync,
  RouteOptions,
} from "fastify";
import fp from "fastify-plugin";

interface ScalarDocsOptions {
  routePrefix?: string;
  openapi?: {
    info: {
      title: string;
      version: string;
      description?: string;
    };
    servers?: Array<{
      url: string;
      description?: string;
    }>;
  };
  scalarOptions?: Record<string, any>;
}

// Interface para armazenar informações das rotas
interface RouteInfo {
  method: string;
  url: string;
  schema?: any;
  tags?: string[];
}

export const fastifyScalarDocs: FastifyPluginAsync<ScalarDocsOptions> = async (
  fastify: FastifyInstance,
  options: ScalarDocsOptions
) => {
  const {
    routePrefix = "/docs",
    openapi = {
      info: {
        title: "API Documentation",
        version: "1.0.0",
      },
    },
    scalarOptions = {},
  } = options;

  // Array para armazenar as rotas conforme são registradas
  const registeredRoutes: RouteInfo[] = [];

  // Hook para capturar rotas conforme são registradas
  fastify.addHook("onRoute", (routeOptions: RouteOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];

    // Filtra apenas métodos HTTP principais, ignorando HEAD automático
    const validMethods = methods.filter((method) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
        method.toUpperCase()
      )
    );

    // Adiciona cada método válido como uma rota separada
    validMethods.forEach((method) => {
      // Evita duplicação - só adiciona se não existir ainda
      const routeExists = registeredRoutes.some(
        (route) => route.method === method && route.url === routeOptions.url
      );

      if (!routeExists) {
        registeredRoutes.push({
          method: method,
          url: routeOptions.url,
          schema: routeOptions.schema,
          tags:
            routeOptions.schema &&
            "tags" in routeOptions.schema &&
            Array.isArray((routeOptions.schema as any).tags)
              ? Array.from((routeOptions.schema as any).tags)
              : [],
        });
      }
    });
  });

  // Rota de debug para testar se o plugin está funcionando
  fastify.get(`${routePrefix}/debug`, async (request, reply) => {
    const routes = registeredRoutes.map((route) => ({
      method: route.method,
      url: route.url,
      hasSchema: !!route.schema,
      schemaKeys: route.schema ? Object.keys(route.schema) : [],
      tags: route.tags,
    }));

    return {
      message: "Plugin Scalar Debug",
      totalRoutes: routes.length,
      routes,
      options: {
        routePrefix,
        openapi,
        scalarOptions,
      },
    };
  });

  // Registra a rota para servir o OpenAPI JSON com debug completo
  fastify.get(`${routePrefix}/openapi.json`, async (request, reply) => {
    try {
      fastify.log.info("🔍 Iniciando geração do OpenAPI spec...");

      const openApiSpec = {
        openapi: "3.0.0",
        ...openapi,
        paths: {} as any,
        components: {
          schemas: {},
        },
      };

      let processedRoutes = 0;
      let skippedRoutes = 0;

      // Extrai as rotas e schemas do array de rotas registradas
      for (const route of registeredRoutes) {
        fastify.log.debug(`🔎 Analisando rota: ${route.method} ${route.url}`);

        // Pula rotas internas do plugin
        if (
          route.url.startsWith(routePrefix) ||
          route.url.startsWith("/_") ||
          route.url.includes("*")
        ) {
          skippedRoutes++;
          fastify.log.debug(
            `⏭️ Pulando rota interna: ${route.method} ${route.url}`
          );
          continue;
        }

        // Só processa rotas com schema
        if (!route.schema) {
          skippedRoutes++;
          fastify.log.debug(
            `⏭️ Pulando rota sem schema: ${route.method} ${route.url}`
          );
          continue;
        }

        try {
          const path = route.url.replace(/:([^/]+)/g, "{$1}");
          const method = route.method.toLowerCase();

          if (!openApiSpec.paths[path]) {
            openApiSpec.paths[path] = {};
          }

          const routeSchema = route.schema as any;
          fastify.log.debug(
            `📋 Schema da rota ${route.method} ${route.url}: ` +
              JSON.stringify({
                hasBody: !!routeSchema.body,
                hasQuerystring: !!routeSchema.querystring,
                hasParams: !!routeSchema.params,
                hasResponse: !!routeSchema.response,
                tags: routeSchema.tags,
              })
          );

          const operationSpec: any = {
            tags: routeSchema.tags || ["default"],
            summary: routeSchema.summary || `${method.toUpperCase()} ${path}`,
            description:
              routeSchema.description ||
              `Endpoint ${method.toUpperCase()} ${path}`,
            parameters: [],
            responses: {},
          };

          // Processa parâmetros de query
          if (routeSchema.querystring) {
            try {
              // Verifica se é um schema Zod válido
              if (routeSchema.querystring.properties) {
                Object.keys(routeSchema.querystring.properties).forEach(
                  (param) => {
                    operationSpec.parameters.push({
                      name: param,
                      in: "query",
                      schema: routeSchema.querystring.properties[param],
                      required:
                        routeSchema.querystring.required?.includes(param) ||
                        false,
                    });
                  }
                );
              } else {
                // Tenta usar o schema diretamente
                operationSpec.parameters.push({
                  name: "query",
                  in: "query",
                  schema: routeSchema.querystring,
                });
              }
              fastify.log.debug(
                `✅ Query params processados para ${route.url}`
              );
            } catch (error) {
              fastify.log.warn(
                `⚠️ Erro ao processar querystring para ${route.url}: ${error}`
              );
            }
          }

          // Processa parâmetros de path
          if (routeSchema.params) {
            try {
              if (routeSchema.params.properties) {
                Object.keys(routeSchema.params.properties).forEach((param) => {
                  operationSpec.parameters.push({
                    name: param,
                    in: "path",
                    schema: routeSchema.params.properties[param],
                    required: true,
                  });
                });
              }
              fastify.log.debug(`✅ Path params processados para ${route.url}`);
            } catch (error) {
              fastify.log.warn(
                `⚠️ Erro ao processar params para ${route.url}: ${error}`
              );
            }
          }

          // Processa body para métodos POST, PUT, PATCH
          if (["post", "put", "patch"].includes(method) && routeSchema.body) {
            try {
              operationSpec.requestBody = {
                required: true,
                content: {
                  "application/json": {
                    schema: routeSchema.body,
                  },
                },
              };
              fastify.log.debug(`✅ Body processado para ${route.url}`);
            } catch (error) {
              fastify.log.warn(
                `⚠️ Erro ao processar body para ${route.url}: ${error}`
              );
            }
          }

          // Processa responses
          try {
            if (
              routeSchema.response &&
              typeof routeSchema.response === "object"
            ) {
              Object.keys(routeSchema.response).forEach((statusCode) => {
                operationSpec.responses[statusCode] = {
                  description: getResponseDescription(statusCode),
                  content: {
                    "application/json": {
                      schema: routeSchema.response[statusCode],
                    },
                  },
                };
              });
            } else {
              // Response padrão
              operationSpec.responses["200"] = {
                description: "Success",
                content: {
                  "application/json": {
                    schema: { type: "object" },
                  },
                },
              };
            }
            fastify.log.debug(`✅ Responses processadas para ${route.url}`);
          } catch (error) {
            fastify.log.warn(
              `⚠️ Erro ao processar responses para ${route.url}: ${error}`
            );
            // Response de fallback
            operationSpec.responses["200"] = {
              description: "Success",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            };
          }

          openApiSpec.paths[path][method] = operationSpec;
          processedRoutes++;
          fastify.log.info(`✅ Rota processada: ${route.method} ${route.url}`);
        } catch (routeError) {
          fastify.log.error(
            `❌ Erro ao processar rota ${route.method} ${route.url}: ${routeError}`
          );
          skippedRoutes++;
        }
      }

      fastify.log.info(
        `📊 Resumo da geração: ${JSON.stringify({
          processedRoutes,
          skippedRoutes,
          totalPaths: Object.keys(openApiSpec.paths).length,
        })}`
      );

      reply.header("Content-Type", "application/json");
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      reply.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );

      return openApiSpec;
    } catch (error) {
      fastify.log.error(`❌ Erro crítico ao gerar OpenAPI spec: ${error} `);
      reply.code(500);
      return {
        error: "Erro interno ao gerar especificação OpenAPI",
        message: error instanceof Error ? error.message : "Erro desconhecido",
        stack: error instanceof Error ? error.stack : undefined,
      };
    }
  });

  // Registra a rota para servir a interface Scalar
  fastify.get(routePrefix, async (request, reply) => {
    const specUrl = `${routePrefix}/openapi.json?ts=${Date.now()}`;

    const html = `
<!doctype html>
<html lang="pt-BR">
  <head>
    <title>${openapi.info.title} - Documentação da API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { 
        margin: 0; 
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .debug-info {
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 9999;
        max-width: 300px;
      }
      .debug-info a {
        color: #4fc3f7;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <!-- Info de debug -->
    <div class="debug-info">
      <strong>🔧 Debug Info</strong><br>
      <a href="${routePrefix}/debug" target="_blank">Ver Debug</a> |
      <a href="${specUrl}" target="_blank">Ver JSON</a>
    </div>

    <!-- Scalar API Reference -->
    <script 
      id="api-reference" 
      type="application/json"
      data-url="${specUrl}"
      ${Object.entries(scalarOptions)
        .map(
          ([key, value]) =>
            `data-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}="${value}"`
        )
        .join("\n      ")}
    ></script>

    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest"></script>
    
    <script>
      console.log('🚀 Debug: Iniciando carregamento do Scalar...');
      console.log('📄 Debug: URL do spec:', '${specUrl}');
      
      // Testa a URL do spec primeiro
      fetch('${specUrl}')
        .then(response => {
          if (!response.ok) {
            console.error('❌ Debug: Erro ao carregar spec:', response.status, response.statusText);
            showDebugError('Erro ' + response.status + ' ao carregar OpenAPI JSON');
          } else {
            console.log('✅ Debug: Spec carregado com sucesso');
            return response.json();
          }
        })
        .then(data => {
          if (data) {
            console.log('📋 Debug: Spec data:', {
              paths: Object.keys(data.paths || {}),
              pathCount: Object.keys(data.paths || {}).length
            });
          }
        })
        .catch(error => {
          console.error('❌ Debug: Erro na requisição do spec:', error);
          showDebugError('Erro de rede: ' + error.message);
        });

      // Verifica se Scalar carregou
      setTimeout(function() {
        const hasScalarContent = document.querySelector('.scalar-app') || 
                               document.querySelector('[data-scalar-api-reference]');
        
        if (!hasScalarContent) {
          console.warn('⚠️ Debug: Scalar não carregou automaticamente');
          showDebugError('Scalar não carregou. Verifique o console para mais detalhes.');
        } else {
          console.log('✅ Debug: Scalar carregado com sucesso!');
        }
      }, 5000);
      
      function showDebugError(message) {
        const debugDiv = document.querySelector('.debug-info');
        if (debugDiv) {
          debugDiv.innerHTML += '<br><br><strong style="color: #f44336;">❌ Erro:</strong><br>' + message;
          debugDiv.style.background = 'rgba(244, 67, 54, 0.9)';
        }
      }
    </script>
  </body>
</html>
    `;

    reply.header("Content-Type", "text/html");
    return html;
  });
};

function getResponseDescription(statusCode: string): string {
  const descriptions: Record<string, string> = {
    "200": "Success",
    "201": "Created",
    "204": "No Content",
    "400": "Bad Request",
    "401": "Unauthorized",
    "403": "Forbidden",
    "404": "Not Found",
    "422": "Unprocessable Entity",
    "500": "Internal Server Error",
  };
  return descriptions[statusCode] || "Response";
}

export default fp(fastifyScalarDocs, {
  fastify: "5.x",
  name: "fastify-scalar-plugin",
});
