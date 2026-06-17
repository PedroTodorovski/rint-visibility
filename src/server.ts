import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`${config.serviceName} listening on ${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
