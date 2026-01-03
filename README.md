# EnvMem

**Your Environment Variables, Always at Hand**

Personal environment variable memory with semantic search. Multi-tenant MCP server that remembers all your API keys, secrets, and configurations.

[![npm version](https://badge.fury.io/js/envmem.svg)](https://www.npmjs.com/package/envmem)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

🌐 **Live Demo**: [https://envmem.trigox.workers.dev](https://envmem.trigox.workers.dev)
📦 **NPM Package**: [https://www.npmjs.com/package/envmem](https://www.npmjs.com/package/envmem)

## Features

- 🔍 **Semantic Search** - Natural language queries powered by Cloudflare Vectorize
- 🔐 **Multi-Tenant Isolation** - Each API key gets completely isolated storage
- 🌐 **MCP Protocol** - Works with Claude, ChatGPT, and any MCP-compatible AI assistant
- 📥 **Import from .env** - Paste your entire .env file, we parse and index automatically
- 📦 **Service Bundles** - Get all env vars for Stripe + Supabase + SendGrid in one query
- ⚡ **Edge-Native** - Sub-50ms responses from 300+ global locations
- 🚀 **NPX Ready** - Run instantly with `npx envmem`

---

## Quick Start

### Option 1: NPX (Recommended)

Run EnvMem directly without installation:

```bash
# Run with API key
ENVMEM_API_KEY=your-key npx envmem

# Or run with help
npx envmem --help
```

### Option 2: Claude Desktop / Claude Code

Add to your MCP configuration (`~/.config/claude/claude_desktop_config.json`):

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

### Option 3: Direct HTTP/SSE URL

Use the MCP URL directly with API key in query string:

```
https://envmem.trigox.workers.dev/mcp?apikey=your-api-key
```

**MCP Client Config (URL mode):**
```json
{
  "mcpServers": {
    "envmem": {
      "url": "https://envmem.trigox.workers.dev/mcp?apikey=your-api-key"
    }
  }
}
```

### Option 4: Header Authentication

```json
{
  "mcpServers": {
    "envmem": {
      "url": "https://envmem.trigox.workers.dev/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

---

## Getting Your API Key

Generate your own API key (any random string works):

```bash
# Generate a secure random key
openssl rand -hex 16
# Example output: 6f43ab7be7ccb6501daf22df7377cd79
```

Your API key creates an isolated storage partition. Each unique key = separate database.

---

## Usage

### 1. Import Your Environment Variables

```javascript
// Import your entire .env file
import_env_variables({
  envText: `
    OPENAI_API_KEY=sk-...
    STRIPE_SECRET_KEY=sk_live_...
    SUPABASE_URL=https://...
    # Database connection
    DATABASE_URL=postgres://...
  `,
  clearExisting: true  // Optional: start fresh
})
```

### 2. Search Naturally

```javascript
// Natural language search
search_env_variables({ query: "payment processing" })
// → STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY

search_env_variables({ query: "email sending" })
// → SENDGRID_API_KEY, MAILJET_API_KEY, BREVO_API_KEY

search_env_variables({ query: "AI code generation" })
// → OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY
```

### 3. Get Specific Variables

```javascript
// Get by exact name
get_env_by_name({ name: "OPENAI_API_KEY" })
// → Full details with description, category, related vars
```

### 4. Get Service Bundles

```javascript
// Get all vars for multiple services
get_envs_for_services({ services: ["Stripe", "OpenAI", "Supabase"] })
// → Complete .env setup for your tech stack
```

---

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
│         │                                      │                    │
│         ▼                                      ▼                    │
│   ┌──────────┐                         ┌───────────────┐           │
│   │    D1    │◀────────────────────────│ Hybrid Search │           │
│   │ (SQLite) │   Semantic + Keyword    │  60% + 30%    │           │
│   └──────────┘                         └───────────────┘           │
│                                                                     │
│  Multi-Tenant: user_id isolation via API key hash                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_env_variables` | Semantic + keyword search for env vars |
| `get_env_by_name` | Get full details by exact name |
| `get_envs_for_services` | Get all vars for multiple services |
| `list_env_categories` | List all categories with counts |
| `import_env_variables` | Bulk import from .env text |
| `add_env_variable` | Add a single variable |
| `delete_env_variable` | Delete by name |
| `clear_all_env_variables` | Delete all (requires confirm) |

### search_env_variables

Search using natural language queries with semantic + keyword matching.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Natural language search (e.g., "AI code generation") |
| `category` | string | | Filter by category (ai_services, payment, database, etc.) |
| `service` | string | | Filter by service name |
| `requiredOnly` | boolean | | Only return required variables |
| `limit` | number | | Max results (default: 10, max: 50) |

### get_env_by_name

Get full details for a specific environment variable.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | ✅ | Exact variable name (e.g., "OPENAI_API_KEY") |

### get_envs_for_services

Get all environment variables needed for multiple services at once.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `services` | string[] | ✅ | Service names (e.g., ["Stripe", "SendGrid", "Supabase"]) |
| `includeOptional` | boolean | | Include optional vars (default: true) |

### import_env_variables

Bulk import environment variables from .env format text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `envText` | string | ✅ | .env file content (NAME=value with optional # comments) |
| `clearExisting` | boolean | | Delete all existing before import (default: false) |

### add_env_variable

Add a single environment variable.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | ✅ | Variable name |
| `description` | string | ✅ | What this variable is used for |
| `service` | string | ✅ | Service name |
| `category` | string | | Category for grouping |
| `example` | string | | Example value (will be sanitized) |
| `required` | boolean | | Is this required? (default: false) |

---

## Categories

| Category | Examples |
|----------|----------|
| `ai_services` | OpenAI, Anthropic, Google AI, Cohere |
| `browser_automation` | Browserbase, E2B, Playwright |
| `database` | Supabase, PlanetScale, MongoDB, Redis |
| `monitoring` | Sentry, Datadog, LogRocket |
| `deployment` | Vercel, Netlify, Fly.io, Railway |
| `auth` | Auth0, Clerk, Firebase Auth |
| `analytics` | PostHog, Mixpanel, Amplitude |
| `storage` | AWS S3, Cloudflare R2, Cloudinary |
| `email` | SendGrid, Mailjet, Resend |
| `sms` | Twilio, Vonage |
| `social` | Twitter API, GitHub, Discord |
| `cms` | Contentful, Sanity, Strapi |
| `payment` | Stripe, PayPal, SumUp |
| `other` | Everything else |

---

## Authentication

EnvMem uses API key authentication for multi-tenant isolation. Each unique API key gets its own isolated database partition.

**Supported Methods (in priority order):**

1. **Header (recommended):**
   ```
   x-api-key: your-api-key
   ```

2. **Bearer Token:**
   ```
   Authorization: Bearer your-api-key
   ```

3. **Query Parameter (easiest):**
   ```
   ?apikey=your-api-key
   ```

**How It Works:**
- Your API key is hashed to create a stable user ID
- All your data is stored with this user ID
- Queries are automatically scoped to your data only
- No API key = anonymous access (shared space)

---

## HTTP API

For direct HTTP access (outside MCP):

```bash
# Search
curl "https://envmem.trigox.workers.dev/search?q=payment&apikey=your-key"

# Health check
curl "https://envmem.trigox.workers.dev/health?apikey=your-key"

# API info
curl "https://envmem.trigox.workers.dev/api"
```

---

## Self-Hosting

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers, D1, and Vectorize access

### Setup

```bash
# Clone repository
git clone https://github.com/samihalawa/envmem-mcp.git
cd envmem-mcp

# Install dependencies
npm install

# Create Cloudflare resources
wrangler d1 create env-reference-db
wrangler vectorize create env-embeddings --dimensions=768 --metric=cosine

# Update wrangler.toml with your database_id

# Run migrations
wrangler d1 migrations apply env-reference-db

# Deploy
wrangler deploy
```

### Configuration

Edit `wrangler.toml`:

```toml
name = "envmem"
main = "src/index.ts"
compatibility_date = "2024-12-13"
compatibility_flags = ["nodejs_compat"]

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "env-reference-db"
database_id = "your-database-id"

[[vectorize]]
binding = "VECTORIZE"
index_name = "env-embeddings"

[assets]
directory = "./public"

[observability]
enabled = true
```

---

## Performance

| Operation | Latency |
|-----------|---------|
| Search (hybrid) | <50ms |
| Embedding generation | ~20-30ms |
| Vector search | ~10ms |
| Keyword search | ~5ms |
| Cold start | ~100ms |

---

## Pricing

**Free Forever** - EnvMem is free for personal use:

- ✅ Unlimited env variables
- ✅ Semantic search
- ✅ Multi-tenant isolation
- ✅ MCP protocol support
- ✅ API key authentication
- ✅ Global edge deployment

---

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Embeddings**: Workers AI (`@cf/baai/bge-base-en-v1.5`, 768-dim)
- **Vector Search**: Cloudflare Vectorize
- **Database**: Cloudflare D1 (SQLite with FTS5)
- **Protocol**: MCP (Model Context Protocol)
- **CLI**: Node.js with stdio-to-HTTP proxy

---

## Related Projects

- [mem0](https://github.com/mem0ai/mem0) - Memory layer for AI apps
- [supermemory](https://github.com/supermemory/supermemory) - Personal knowledge base

---

## License

ISC

---

Built with ❤️ for developers who forget their env var names.
