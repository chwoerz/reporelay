/**
 * MCP server entrypoint.
 *
 * Bootstraps DB, creates embedder, then starts the MCP server
 * (stdio or HTTP transport). Migrations are handled by the worker.
 */
import { bootstrap, setupGracefulShutdown } from "../core/index.js";
import { parseLanguageFilter } from "../core/config.js";
import { startMcpServer } from "./server.js";

async function main(): Promise<void> {
  const { config, logger, sql, db, embedder } = await bootstrap();

  logger.info({ transport: config.MCP_TRANSPORT }, "Starting MCP server…");

  const languages = parseLanguageFilter(config.MCP_LANGUAGES);
  if (languages) {
    logger.info({ languages }, "Language filter active — only these languages will be served");
  }

  // Start MCP server
  await startMcpServer({ db, embedder, config, languages });

  if (config.MCP_TRANSPORT === "http") {
    logger.info({ port: config.MCP_SERVER_PORT }, "MCP server listening (HTTP)");

    // Graceful shutdown (HTTP mode only — stdio is managed by the client)
    setupGracefulShutdown(logger, "MCP server", [async () => sql.end()]);
  } else {
    logger.info("MCP server connected (stdio)");
  }
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
