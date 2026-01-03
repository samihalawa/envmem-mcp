# Deployment Guide - EnvMem

Complete deployment verification and testing guide for EnvMem on Cloudflare Workers.

**Live Deployment**: https://envmem.trigox.workers.dev
**NPM Package**: https://www.npmjs.com/package/envmem
**Repository**: https://github.com/samihalawa/envmem-mcp

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Worker | ✅ Deployed | envmem.trigox.workers.dev |
| NPM Package | ✅ Published | `npx envmem` v1.1.0 |
| Landing Page | ✅ Live | Static assets served from /public |
| D1 Database | ✅ Working | SQLite with FTS5 |
| Vectorize | ✅ Working | Semantic search operational |
| MCP Protocol | ✅ Working | HTTP streamable + SSE |
| Multi-Tenant | ✅ Working | API key isolation via user_id hash |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers                           │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐           │
│  │ MCP Server  │───▶│  Workers AI │───▶│  Vectorize   │           │
│  │ (HTTP/SSE)  │    │ (Embeddings)│    │  (Semantic)  │           │
│  └─────────────┘    └─────────────┘    └──────────────┘           │
│         │                                      │                    │
│         ▼                                      ▼                    │
│   ┌──────────┐                         ┌───────────────┐           │
│   │    D1    │◀────────────────────────│ Hybrid Search │           │
│   │ (SQLite) │   60% Semantic + 30%    │   FTS5/LIKE   │           │
│   └──────────┘      Keyword            └───────────────┘           │
│                                                                     │
│  Multi-Tenant: user_id isolation via API key hash                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### NPX (Recommended)

```bash
# Run with API key
ENVMEM_API_KEY=your-key npx envmem

# Or with --help
npx envmem --help
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "envmem": {
      "command": "npx",
      "args": ["-y", "envmem"],
      "env": {
        "ENVMEM_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### URL with API Key in Query

```
https://envmem.trigox.workers.dev/mcp?apikey=your-api-key
```

## Quick Verification

```bash
# Landing page
curl https://envmem.trigox.workers.dev/

# Health check with API key
curl "https://envmem.trigox.workers.dev/health?apikey=your-key"

# Search test
curl "https://envmem.trigox.workers.dev/search?q=email&apikey=your-key"

# API info
curl https://envmem.trigox.workers.dev/api
```

## File Structure

```
✅ wrangler.toml        - Cloudflare Workers config
✅ package.json         - Dependencies + npm publishing config
✅ smithery.yaml        - Smithery/npx deployment config
✅ tsconfig.json        - TypeScript config
✅ bin/envmem.js        - CLI entry point for npx
✅ src/index.ts         - Main Worker entry (MCP + HTTP routes)
✅ src/types.ts         - TypeScript interfaces
✅ src/cloudflare-vector-store.ts - Vector store with multi-tenant support
✅ src/sample-envs.ts   - Sample environment variables
✅ public/index.html    - Landing page
✅ migrations/0001_*.sql - Initial schema
✅ migrations/0002_*.sql - Multi-tenant schema
```

## Self-Hosting Deployment

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Cloudflare Resources
```bash
# Create D1 database
wrangler d1 create env-reference-db
# Note: Copy the database_id from output

# Create Vectorize index
wrangler vectorize create env-embeddings --dimensions=768 --metric=cosine
```

### 3. Update wrangler.toml
```toml
[[d1_databases]]
binding = "DB"
database_name = "env-reference-db"
database_id = "your-database-id-here"
```

### 4. Run Migrations
```bash
wrangler d1 migrations apply env-reference-db
```

### 5. Deploy
```bash
wrangler deploy
```

## Testing Endpoints

### Landing Page
```bash
curl https://envmem.trigox.workers.dev/
# Returns HTML landing page
```

### Health Check
```bash
curl "https://envmem.trigox.workers.dev/health?apikey=your-key"
```
```json
{
  "status": "healthy",
  "service": "envmem",
  "version": "1.1.0",
  "authenticated": true,
  "userId": "user_xxx",
  "stats": {
    "total": 48,
    "byCategory": {...},
    "byService": {...}
  }
}
```

### Search
```bash
curl "https://envmem.trigox.workers.dev/search?q=payment&apikey=your-key"
```
```json
{
  "query": "payment",
  "results": [
    {
      "env": {
        "name": "STRIPE_SECRET_KEY",
        "description": "Stripe API secret key..."
      },
      "score": 0.89,
      "matchType": "hybrid"
    }
  ]
}
```

### MCP Protocol
```bash
# List tools
curl -X POST "https://envmem.trigox.workers.dev/mcp?apikey=your-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Search
curl -X POST "https://envmem.trigox.workers.dev/mcp?apikey=your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params": {
      "name": "search_env_variables",
      "arguments": {"query": "AI services"}
    }
  }'
```

## Multi-Tenant Architecture

Each API key gets isolated storage:

1. **API Key → User ID**: `user_id = hash(api_key).substring(0, 6)`
2. **Isolation**: All queries filtered by `WHERE user_id = ?`
3. **Vectorize Namespace**: Each user's vectors tagged with user_id
4. **Anonymous Fallback**: No API key = shared `anonymous` space

### Authentication Methods

| Method | Example |
|--------|---------|
| Header | `x-api-key: your-key` |
| Bearer | `Authorization: Bearer your-key` |
| Query | `?apikey=your-key` |

## Monitoring

### View Logs
```bash
wrangler tail
```

### Check Database
```bash
# Count records
wrangler d1 execute env-reference-db --command \
  "SELECT COUNT(*) FROM env_variables"

# Check schema
wrangler d1 execute env-reference-db --command \
  "PRAGMA table_info(env_variables)"
```

### Verify Vectorize
```bash
wrangler vectorize get env-embeddings
```

## Troubleshooting

### MCP SDK Not Working
- Verify `compatibility_flags = ["nodejs_compat"]` in wrangler.toml
- Redeploy: `wrangler deploy`

### Search Returns No Results
- Verify API key is correct and data was imported
- Check /health endpoint for stats
- Each API key has isolated storage

### Authorization Errors
- D1 migrations require specific API token permissions
- Use Cloudflare Dashboard as alternative

### NPX Not Working
- Clear npm cache: `npm cache clean --force`
- Reinstall: `npx envmem@latest`

## Performance

| Operation | Latency |
|-----------|---------|
| Landing page | <10ms |
| Health check | <20ms |
| Search (hybrid) | <50ms |
| Embedding generation | ~20-30ms |
| Cold start | ~100ms |

## NPM Publishing

```bash
# Update version
npm version patch  # or minor/major

# Login (if needed)
npm login

# Publish
npm publish
```

## Success Criteria

- ✅ Landing page loads at /
- ✅ /health returns authenticated stats
- ✅ /search returns hybrid search results
- ✅ /mcp responds to JSON-RPC requests
- ✅ API key in URL query string works
- ✅ Multi-tenant isolation verified
- ✅ npx envmem works globally
- ✅ NPM package published

## Tech Stack

**100% Cloudflare Services**:
- Workers AI: BGE-base-en-v1.5 embeddings (768-dim)
- Vectorize: Semantic similarity search
- D1: SQLite with FTS5/LIKE keyword search
- Workers: Edge compute with static assets

**NPM Package**:
- CLI wrapper: Node.js stdio-to-HTTP proxy
- MCP SDK: @modelcontextprotocol/sdk v1.20.0
