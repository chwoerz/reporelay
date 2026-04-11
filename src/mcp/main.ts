/**
 * MCP server entrypoint.
 *
 * Bootstraps DB, creates embedder, then starts the MCP server
 * as a stateless HTTP service.  Clients connect via the local
 * MCP proxy (`src/mcp-proxy/`), never directly.
 */
import {bootstrap, setupGracefulShutdown} from "../core/index.js";
import {startMcpServer} from "./server.js";

async function main(): Promise<void> {
  const {config, logger, sql, db, embedder} = await bootstrap();

  logger.info("Starting MCP server (HTTP)…");

  // Resolve language filter: explicit env var takes priority, then auto-detect from CWD.
  // Threshold of 0 disables language-based repo filtering entirely.
  const languageThreshold = config.MCP_LANGUAGE_THRESHOLD;

  if (languageThreshold === 0) {
    logger.info("Language-based repo filtering disabled (MCP_LANGUAGE_THRESHOLD=0)");
    // but skip auto-detection since repo filtering is off.
  }

  // Start MCP HTTP server
  const httpServer = await startMcpServer({db, embedder, config, languageThreshold});

  logger.info({port: config.MCP_SERVER_PORT}, "MCP server listening (HTTP)");

  setupGracefulShutdown(logger, "MCP server", [
    async () => {
      httpServer.close();
      await sql.end();
    },
  ]);
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
