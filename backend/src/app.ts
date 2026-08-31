import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { attachUser } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { apiRateLimit, verifyRequestOrigin } from "./middleware/security.js";
import { apiRouter } from "./routes/index.js";

export function createApp(): Express {
  const app = express();

  // Required for correct client IPs and secure cookies behind a proxy or load
  // balancer (Render, Railway, Fly, Nginx).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      // Health checks are polled constantly; logging them buries real traffic.
      autoLogging: { ignore: (req: IncomingMessage) => req.url === "/api/health" },
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) =>
        res.statusCode >= 500 || error ? "error" : res.statusCode >= 400 ? "warn" : "info",
    }),
  );

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser clients send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);

        // Refuse by withholding the headers, never by throwing. Throwing here
        // sends the request to the error handler, so the browser sees an
        // unexplained 500 and the log records a server fault rather than the
        // configuration mistake this actually is. Say plainly what was
        // rejected and what would have been accepted — this line is the whole
        // diagnosis when a deployment cannot talk to its API.
        logger.warn(
          { origin, allowed: env.corsOrigins },
          "Refused a cross-origin request: this origin is not in CORS_ORIGINS",
        );
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api", apiRateLimit, verifyRequestOrigin, attachUser, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}