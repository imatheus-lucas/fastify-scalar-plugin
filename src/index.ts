// fastify-scalar-docs-debug.ts
import type {
  FastifyInstance,
  FastifyPluginAsync,
  RouteOptions,
} from "fastify";
import fp from "fastify-plugin";
import { z } from "zod/v4";

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

  const registeredRoutes: RouteInfo[] = [];

  fastify.addHook("onRoute", (routeOptions: RouteOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];

    const validMethods = methods.filter((method) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
        method.toUpperCase()
      )
    );

    validMethods.forEach((method) => {
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

      for (const route of registeredRoutes) {
        fastify.log.debug(`🔎 Analisando rota: ${route.method} ${route.url}`);

        fastify.log.info({
          message: "[DEBUG] Inspecionando rota capturada pelo onRoute",
          routeDetails: {
            url: route.url,
            method: route.method,
            hasSchema: !!route.schema,

            schemaKeys: route.schema
              ? Object.keys(route.schema)
              : "Nenhum schema encontrado",
          },
        });
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

          if (routeSchema.querystring) {
            try {
              const querySchema = convertSchemaToOpenAPI(
                routeSchema.querystring,
                fastify.log
              );

              if (querySchema.properties) {
                Object.keys(querySchema.properties).forEach((param) => {
                  const paramSchema = querySchema.properties[param];
                  operationSpec.parameters.push({
                    name: param,
                    in: "query",
                    schema: paramSchema,
                    required: querySchema.required?.includes(param) || false,
                    description: paramSchema.description || undefined,
                  });
                });
              }
              fastify.log.debug(
                `✅ Query params processados para ${route.url}`
              );
            } catch (error) {
              fastify.log.warn(
                error,
                `⚠️ Erro ao processar querystring para ${route.url}:`
              );
            }
          }

          if (routeSchema.params) {
            try {
              const paramsSchema = convertSchemaToOpenAPI(
                routeSchema.params,
                fastify.log
              );

              if (paramsSchema.properties) {
                Object.keys(paramsSchema.properties).forEach((param) => {
                  const paramSchema = paramsSchema.properties[param];
                  operationSpec.parameters.push({
                    name: param,
                    in: "path",
                    schema: paramSchema,
                    required: true,
                    description: paramSchema.description || undefined,
                  });
                });
              }
              fastify.log.debug(`✅ Path params processados para ${route.url}`);
            } catch (error) {
              fastify.log.warn(
                error,
                `⚠️ Erro ao processar params para ${route.url}:`
              );
            }
          }

          if (["post", "put", "patch"].includes(method) && routeSchema.body) {
            try {
              const bodySchema = convertSchemaToOpenAPI(
                routeSchema.body,
                fastify.log
              );
              operationSpec.requestBody = {
                required: true,
                content: {
                  "application/json": {
                    schema: bodySchema,
                  },
                },
              };
              fastify.log.debug(`✅ Body processado para ${route.url}`);
            } catch (error) {
              fastify.log.warn(
                error,
                `⚠️ Erro ao processar body para ${route.url}:`
              );
            }
          }

          try {
            if (
              routeSchema.response &&
              typeof routeSchema.response === "object"
            ) {
              Object.keys(routeSchema.response).forEach((statusCode) => {
                const responseSchema = convertSchemaToOpenAPI(
                  routeSchema.response[statusCode],
                  fastify.log
                );
                operationSpec.responses[statusCode] = {
                  description: getResponseDescription(statusCode),
                  content: {
                    "application/json": {
                      schema: responseSchema,
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
              error,
              `⚠️ Erro ao processar responses para ${route.url}:`
            );

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
            routeError,
            `❌ Erro ao processar rota ${route.method} ${route.url}:`
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
      fastify.log.error(error, "❌ Erro crítico ao gerar OpenAPI spec:");
      reply.code(500);
      return {
        error: "Erro interno ao gerar especificação OpenAPI",
        message: error instanceof Error ? error.message : "Erro desconhecido",
        stack: error instanceof Error ? error.stack : undefined,
      };
    }
  });

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

function convertSchemaToOpenAPI(schema: any, logger: any): any {
  const isZodSchema = !!schema?._def;

  if (isZodSchema) {
    try {
      const convertedSchema = z.toJSONSchema(schema, { target: "openapi-3.0" });

      const { $schema, ...rest } = convertedSchema;

      return rest;
    } catch (error) {
      return {
        type: "object",
        description: "ERRO: Falha ao converter este schema Zod.",
      };
    }
  }

  return schema;
}
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
  name: "fastify-scalar-docs-debug",
});
