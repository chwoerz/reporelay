# Embedding Providers

RepoRelay supports multiple embedding providers, selected via the `EMBEDDING_PROVIDER` environment variable.

| Provider          | Value    | Description                                                                  |
| ----------------- | -------- | ---------------------------------------------------------------------------- |
| Ollama (default)  | `ollama` | Local embedding via Ollama                                                   |
| OpenAI-compatible | `openai` | Any OpenAI-compatible API (OpenAI, Azure OpenAI, Together AI, Mistral, etc.) |

## Ollama

Ollama runs natively on macOS with Metal GPU acceleration — no Docker needed for the embedding model.

```bash
brew install ollama
ollama serve
ollama pull nomic-embed-text
```

Add to `.env`:

```sh
EMBEDDING_PROVIDER=ollama          # default, can be omitted
EMBEDDING_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```

## OpenAI-compatible

Works with any provider that implements the OpenAI `POST /v1/embeddings` endpoint format — OpenAI, Azure OpenAI, Together AI, Mistral, etc.

Add to `.env`:

```sh
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=sk-...
```

### Optional settings

```sh
# Custom base URL for OpenAI-compatible providers (default: https://api.openai.com/v1)
EMBEDDING_URL=https://my-proxy.example.com/v1

# Request a specific number of dimensions from the API.
# Only supported by text-embedding-3 and later models.
# Must produce vectors matching DB_EMBEDDING_DIMENSIONS (768) or init() will report a mismatch.
EMBEDDING_DIMENSIONS=768
```

### Model compatibility

The database schema stores embeddings as 768-dimensional vectors. At startup, RepoRelay probes the configured model and verifies the returned vector width matches. If there is a dimension mismatch, the embedder logs a warning and embedding features are disabled until the configuration is corrected.

For OpenAI models:

- `text-embedding-3-small` (1536-d default) — set `EMBEDDING_DIMENSIONS=768` to reduce to 768-d
- `text-embedding-3-large` (3072-d default) — set `EMBEDDING_DIMENSIONS=768` to reduce to 768-d
- `text-embedding-ada-002` (1536-d fixed) — does **not** support the `dimensions` parameter; cannot be used with the default 768-d schema
