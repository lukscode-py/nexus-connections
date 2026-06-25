import express from "express";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { apiRouter } from "./http/routes/api.routes.js";
import {
  cleanupExpiredSessions,
  startCleanupJob
} from "./sessions/cleanup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const app = express();

app.disable("x-powered-by");

if (env.http.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "font-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(express.json({ limit: env.http.jsonLimit }));
app.use(express.urlencoded({ extended: false, limit: env.http.jsonLimit }));

app.use("/api", apiRouter);

app.use(express.static(publicDir, {
  etag: true,
  maxAge: env.isProduction ? "1h" : 0
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      code: "not_found",
      message: "Rota não encontrada."
    });
  }

  if (req.method !== "GET") {
    return next();
  }

  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("[NC_ERROR]", err);

  res.status(500).json({
    ok: false,
    code: "internal_error",
    message: "Não foi possível concluir agora. Tente novamente em instantes."
  });
});

if (process.env.VERCEL) {
  cleanupExpiredSessions();
} else {
  startCleanupJob();

  app.listen(env.app.port, () => {
    console.log(`[NC] ${env.app.name} rodando em ${env.app.baseUrl}`);
  });
}

export default app;
