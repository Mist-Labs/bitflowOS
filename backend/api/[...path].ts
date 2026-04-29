import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp() {
  appPromise ??= buildServer().then(async ({ app }) => {
    await app.ready();
    return app;
  });
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
