# env-reference-mcp

**Semantic Environment Variable Search MCP Server on Cloudflare Workers**

Production-grade MCP server with async semantic search using Cloudflare's edge platform. Agents can search environment variables using natural language queries like "browser automation" → `BROWSERBASE_API_KEY`, `E2B_API_KEY`, `PLAYWRIGHT_BROWSERS_PATH`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers                           │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐          │
│  │ MCP Server  │───▶│   Queue     │───▶│   Consumer   │          │
│  │ (HTTP)      │    │ (async)     │    │   Worker     │          │
│  └─────────────┘    └─────────────┘    └──────────────┘          │
│                                               │                     │
│                                               ▼                     │
│                                         Workers AI                  │
│                                      (BGE-base-en-v1.5)            │
│                                               │                     │
│                          ┌────────────────────┴───────────────┐   │
│                          ▼                                    ▼   │
│                    Vectorize (768-dim)                  D1 SQLite  │
│                    Semantic Search                      Metadata   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

Flow:
1. MCP tool call → Insert to D1 → Queue message
2. Queue consumer → Generate embedding → Store in Vectorize
3. Search query → Hybrid (Vectorize + FTS5) → Ranked results
```

## Features

- 🚀 **Async Queue Processing** - Instant responses, background embeddings
- 🔍 **Hybrid Search** - 60% semantic + 30% keyword + 10% metadata
- ⚡ **Edge Performance** - <50ms queries on Cloudflare's global network  
- 🎯 **Production-Ready** - Exponential backoff, retry logic, observability
- 📊 **Analytics** - Track indexing status, search queries, popular results
- 🌐 **Dual Interface** - HTTP API + MCP protocol

## Stack (100% Cloudflare)

- **Workers AI** - `@cf/baai/bge-base-en-v1.5` embeddings (768-dim)
- **Vectorize** - Vector similarity search
- **D1** - SQLite with FTS5 for keyword search + metadata
- **Queue** - Async embedding generation
- **Observability** - Request logging and monitoring

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create env-reference-db
# Output: database_id = "abc-123-def..."

# Create Vectorize index
wrangler vectorize create env-embeddings --dimensions=768 --metric=cosine

# Create Queue
wrangler queues create env-indexing-queue
```

### 3. Configure wrangler.toml

Replace `YOUR_DATABASE_ID` in `wrangler.toml` with the database_id from step 2:

```toml
[[d1_databases]]
binding = "DB"
database_name = "env-reference-db"
database_id = "abc-123-def..."  # <-- Your database ID here
```

### 4. Run Migrations

```bash
wrangler d1 migrations apply env-reference-db
```

### 5. Deploy

```bash
wrangler deploy
```

### 6. Seed Data

```bash
# Seed with 20+ sample environment variables
curl -X POST https://your-worker.workers.dev/seed

# Check indexing status
curl https://your-worker.workers.dev/stats
```

## Usage

### HTTP API

```bash
# Search for environment variables
curl "https://your-worker.workers.dev/search?q=browser%20automation"

# Filter by category
curl "https://your-worker.workers.dev/search?q=ai&category=ai_services"

# Get specific variable
curl "https://your-worker.workers.dev/search?q=OPENAI_API_KEY"

# Statistics
curl "https://your-worker.workers.dev/stats"
```

### MCP Protocol

Configure in Claude Code:

```json
{
  "mcpServers": {
    "env-reference": {
      "url": "https://your-worker.workers.dev/mcp",
      "type": "http"
    }
  }
}
```

Then use in AI agents:

```
search_env_variables("browser automation")
→ BROWSERBASE_API_KEY, E2B_API_KEY, PLAYWRIGHT_BROWSERS_PATH

search_env_variables("AI code generation") 
→ OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_COPILOT_TOKEN

get_env_by_name("SENTRY_DSN")
→ Full details including related variables
```

## MCP Tools

### 1. search_env_variables

Search using natural language queries with semantic + keyword matching.

**Parameters:**
- `query` (required): Natural language search
- `category` (optional): Filter by category
- `service` (optional): Filter by service
- `requiredOnly` (optional): Only required variables
- `limit` (optional): Max results (default: 10)

**Example:**
```json
{
  "query": "monitoring and logging",
  "category": "monitoring",
  "limit": 5
}
```

**Response:**
```json
{
  "results": [
    {
      "name": "SENTRY_DSN",
      "description": "Sentry error tracking...",
      "category": "monitoring",
      "service": "Sentry",
      "required": false,
      "relevanceScore": "0.892",
      "matchType": "hybrid"
    }
  ]
}
```

### 2. get_env_by_name

Get full details for specific environment variable.

**Parameters:**
- `name` (required): Exact variable name

### 3. list_env_categories

List all categories with counts and services.

## Adding Your Variables

Edit `src/sample-envs.ts`:

```typescript
{
  name: 'YOUR_API_KEY',
  description: 'Detailed description for semantic matching',
  category: 'ai_services', // Choose appropriate category
  service: 'YourService',
  required: true,
  example: 'your_example_value',
  keywords: ['keyword1', 'keyword2', 'better', 'matching'],
  relatedTo: ['RELATED_VAR_1', 'RELATED_VAR_2'],
}
```

Deploy and seed:

```bash
wrangler deploy
curl -X POST https://your-worker.workers.dev/seed
```

## Architecture Patterns

### Async Queue Pattern (from engram repo)

```typescript
// 1. Instant response
await env.QUEUE.send({ envVariableId, name, text });

// 2. Background processing
async queue(batch, env) {
  for (const msg of batch.messages) {
    // Generate embeddings
    const vector = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [msg.body.text]
    });
    
    // Store in Vectorize
    await env.VECTORIZE.insert([{ id, values: vector.data[0] }]);
    
    msg.ack();
  }
}
```

### Hybrid Search (60-30-10 scoring)

```typescript
// Semantic similarity (60%)
vectorResults = await env.VECTORIZE.query(embedding, { topK: 20 });

// Keyword matching (30%)  
keywordResults = await env.DB.prepare(
  'SELECT * FROM env_fts WHERE env_fts MATCH ?'
).all(query);

// Merge + metadata boost (10%)
finalScore = (semantic * 0.6) + (keyword * 0.3) + (metadata * 0.1);
```

## Database Schema

### env_variables
- Core metadata (name, description, category, service)
- Vector reference (vector_id, indexed_at)
- Search data (keywords, related_to)

### indexing_status
- Track async processing (queued → processing → indexed/failed)
- Retry counts and error messages

### search_analytics
- Query logging for insights
- Top results tracking

## Performance

- **Queue Latency**: Instant (non-blocking)
- **Embedding Generation**: ~20-30ms (Workers AI)
- **Vector Search**: ~10ms (Vectorize)
- **Keyword Search**: ~5ms (D1 FTS5)
- **Total Search**: <50ms (hybrid)
- **Cold Start**: ~100ms

## Monitoring

```bash
# Check indexing queue
wrangler queues consumer get env-indexing-queue

# View logs
wrangler tail

# D1 queries
wrangler d1 execute env-reference-db --command \
  "SELECT status, COUNT(*) FROM indexing_status GROUP BY status"
```

## Troubleshooting

### Embeddings not generating

Check queue consumer:
```bash
wrangler queues consumer get env-indexing-queue
```

### Search returns no results

Check indexing status:
```bash
curl https://your-worker.workers.dev/stats
```

Should show `indexed` count > 0.

## Production Checklist

- [x] `nodejs_compat` flag enabled
- [x] Async queue processing
- [x] Exponential backoff retry
- [x] Observability enabled
- [x] Error tracking in D1
- [x] Search analytics
- [ ] AI Gateway configured (optional)
- [ ] Rate limiting (optional)

## License

ISC

---

**Inspired by:**
- [Foundation42/engram](https://github.com/Foundation42/engram) - Async queue pattern
- [miantiao-me/github-stars](https://github.com/miantiao-me/github-stars) - AutoRAG usage
- [seratch/openai-sdk-knowledge-org](https://github.com/seratch/openai-sdk-knowledge-org) - Production patterns
