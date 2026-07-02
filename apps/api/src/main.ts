import "reflect-metadata";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module.js";
import type { EnvConfig } from "./config/env.validation.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());

  const config = app.get(ConfigService<EnvConfig, true>);

  app.enableCors({
    origin: config.get("WEB_ORIGIN", { infer: true }),
    credentials: true,
  });

  const port = config.get("PORT", { infer: true });

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`workflo-api listening on http://localhost:${port}/api/v1`);
}

bootstrap();
