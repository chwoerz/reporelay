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
EMBEDDING_CONCURRENCY=4            # must match OLLAMA_NUM_PARALLEL
```

### Tuning parallelism

Indexing large repos is typically bottlenecked on embedding throughput. Two knobs have to agree:

- **`EMBEDDING_CONCURRENCY`** (RepoRelay) — how many batches RepoRelay dispatches in parallel.
- **`OLLAMA_NUM_PARALLEL`** (Ollama server) — how many requests the Ollama server will process concurrently. Extra client requests just queue.

Setting `EMBEDDING_CONCURRENCY` higher than `OLLAMA_NUM_PARALLEL` gains nothing. Start with both at `4`.

**macOS (Ollama.app):** env vars set in your shell are ignored — the app reads them from `launchctl`. Quit Ollama, then:

```bash
launchctl setenv OLLAMA_NUM_PARALLEL 4
launchctl setenv OLLAMA_MAX_LOADED_MODELS 1
# Relaunch Ollama from the menu bar
```

**Linux / `ollama serve` directly:** `OLLAMA_NUM_PARALLEL=4 ollama serve`.

If the embedding model is running on CPU or a single GPU that's already saturated by one request, parallelism won't help — requests will accept concurrently but serialize internally. In that case lower `EMBEDDING_CONCURRENCY` back to `1`.

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
