import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { registerRoutes } from "./routes.js";
import { runMigrations } from "./storage/postgres.js";

export async function buildServer() {
  const config = loadConfig();
  await runMigrations(config.databaseUrl);
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  await app.register(cors, {
    origin: config.corsOrigin === "*" ? true : config.corsOrigin,
    credentials: true
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const typedError = error as Error & { statusCode?: number };
    const statusCode = typedError.statusCode ?? 400;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: typedError.message
    });
  });

  await registerRoutes(app, config);
  return { app, config };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, config } = await buildServer();
  await app.listen({ host: config.host, port: config.port });
}
