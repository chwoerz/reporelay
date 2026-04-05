# Embedding Providers

Controlled by the `EMBEDDING_PROVIDER` environment variable.

## Ollama

Ollama runs natively on macOS with Metal GPU acceleration — no Docker needed for the embedding model.

```bash
brew install ollama
ollama serve
ollama pull nomic-embed-text
```

Add to `.env`:

```sh
EMBEDDING_PROVIDER=ollama
EMBEDDING_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```
