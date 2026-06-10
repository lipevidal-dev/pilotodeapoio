import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./routes/index.js";

export async function createHttpServer() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  const origins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()) ?? [
    "http://localhost:4200",
    "http://localhost:4201",
  ];

  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await registerRoutes(app);

  return app;
}
