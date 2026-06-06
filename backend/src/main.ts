import { createHttpServer } from "./interfaces/http/server.js";

const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";

const app = await createHttpServer();

try {
  await app.listen({ port, host });
  app.log.info(`API escala-pao v2 em http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
