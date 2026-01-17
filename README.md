# EnvMem

![EnvMem Hero](https://envmem.com/img/hero.jpg)

**Your Environment Variables, Always at Hand**

Personal environment variable memory with semantic search and project management. Multi-tenant MCP server that remembers all your API keys, secrets, and configurations.

[![npm version](https://badge.fury.io/js/envmem.svg)](https://www.npmjs.com/package/envmem)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

**Live**: [envmem.com](https://envmem.com) | **NPM**: [npmjs.com/package/envmem](https://www.npmjs.com/package/envmem)

![EnvMem Terminal](https://envmem.com/img/terminal.jpg)

## Features

- **Semantic Search** - Natural language queries powered by Cloudflare Vectorize
- **Project Management** - Organize envs by project with dev/staging/prod environments
- **Auto-Fill .env** - Parse .env.example and fill with your stored values
- **Multi-Tenant Isolation** - Each API key gets completely isolated storage
- **MCP Protocol** - Works with Claude, ChatGPT, and any MCP-compatible AI
- **Service Bundles** - Get all env vars for Stripe + Supabase + OpenAI in one query
- **Edge-Native** - Sub-50ms responses from 300+ global locations

---

## 🚀 Quick Start & MCP Configuration

EnvMem is designed to work seamlessly with any MCP-compatible client (like Claude Desktop, Cursor, or your own tools).

### Option 1: Claude Desktop (Recommended)

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "envmem": {
      "command": "npx",
      "args": ["-y", "envmem"],
      "env": {
        "ENVMEM_API_KEY": "your-secret-api-key"
      }
    }
  }
}
```

> **Note:** Generate your API key at [envmem.com](https://envmem.com) or use any random string (it acts as your personal partition).

### Option 2: Remote MCP (No Node.js required)

If your MCP client supports remote URLs (SSE), you can connect directly without running anything locally:

```json
{
  "mcpServers": {
    "envmem": {
      "url": "https://envmem.com/mcp?apikey=your-secret-api-key"
    }
  }
}
```

### Option 3: Cursor / Claude Code (VS Code)

Add this to `~/.cursor/mcp.json` (or your Claude Code MCP config):

```json
{
  "mcpServers": {
    "envmem": {
      "command": "npx",
      "args": ["-y", "envmem"],
      "env": {
        "ENVMEM_API_KEY": "your-secret-api-key"
      }
    }
  }
}
```

### Option 4: Browser & Cloud Hosts

Use the hosted SSE endpoint when you cannot run Node locally (e.g., browser-based IDEs or cloud runners):

```json
{
  "mcpServers": {
    "envmem": {
      "url": "https://envmem.com/mcp?apikey=your-secret-api-key"
    }
  }
}
```

---

## Usage

### 1. Import Your Variables

```javascript
import_env_variables({
  envText: `
    OPENAI_API_KEY=sk-...
    STRIPE_SECRET_KEY=sk_live_...
    DATABASE_URL=postgres://...
  `
})
```

### 2. Create a Project

```javascript
create_project({
  name: "my-saas",
  repoUrl: "github.com/me/my-saas",
  tags: ["nextjs", "stripe", "supabase"]
})
```

### 3. Link Services to Project

```javascript
link_services_to_project({
  projectName: "my-saas",
  services: ["Stripe", "Supabase", "OpenAI", "Clerk"]
})
```

### 4. Get Complete .env File

```javascript
get_envs_for_project({
  projectName: "my-saas",
  environment: "prod"
})
// Returns ready-to-use .env file content
```

### 5. Auto-Fill from .env.example

```javascript
fill_env_example({
  envExampleContent: `OPENAI_API_KEY=\nSTRIPE_SECRET_KEY=\nDATABASE_URL=`,
  projectName: "my-saas"
})
// Returns filled .env with your stored values
```

---

## MCP Tools

### Search & Retrieve

| Tool | Description |
|------|-------------|
| `search_env_variables` | Semantic + keyword search |
| `get_env_by_name` | Get by exact name |
| `get_envs_for_services` | Get all vars for services |
| `list_env_categories` | List categories with counts |

### Import & Manage

| Tool | Description |
|------|-------------|
| `import_env_variables` | Bulk import from .env text |
| `add_env_variable` | Add single variable |
| `delete_env_variable` | Delete by name |
| `clear_all_env_variables` | Delete all (requires confirm) |

### Project Management

| Tool | Description |
|------|-------------|
| `create_project` | Create project with repo URL + tags |
| `list_projects` | List all your projects |
| `link_env_to_project` | Link env to project (dev/staging/prod) |
| `link_services_to_project` | Bulk link services to project |
| `get_envs_for_project` | Get .env file for project |
| `fill_env_example` | Auto-fill .env.example |
| `delete_project` | Delete project + links |

---

## Typical Workflow

```javascript
// 1. Import your envs once
import_env_variables({ envText: "..." })

// 2. Create project
create_project({ name: "autoclient", repoUrl: "github.com/me/autoclient" })

// 3. Link services
link_services_to_project({
  projectName: "autoclient",
  services: ["Stripe", "Supabase", "OpenAI"]
})

// 4. Get .env for deployment
get_envs_for_project({ projectName: "autoclient", environment: "prod" })
```

---

## Categories

| Category | Examples |
|----------|----------|
| `ai_services` | OpenAI, Anthropic, Google AI |
| `database` | Supabase, PlanetScale, MongoDB |
| `payment` | Stripe, PayPal, SumUp |
| `auth` | Auth0, Clerk, Firebase |
| `email` | SendGrid, Mailjet, Resend |
| `deployment` | Vercel, Netlify, Railway |
| `storage` | S3, Cloudflare R2, Cloudinary |
| `monitoring` | Sentry, Datadog |

---

## Authentication

Your API key creates isolated storage. Generate one:

```bash
openssl rand -hex 16
```

Pass via:
- Header: `x-api-key: your-key`
- Bearer: `Authorization: Bearer your-key`
- Query: `?apikey=your-key`

---

## Self-Hosting

```bash
git clone https://github.com/samihalawa/envmem-mcp.git
cd envmem-mcp
npm install

# Create Cloudflare resources
wrangler d1 create env-reference-db
wrangler vectorize create env-embeddings --dimensions=768 --metric=cosine

# Apply migrations
wrangler d1 migrations apply env-reference-db --remote

# Deploy
wrangler deploy
```

---

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Embeddings**: Workers AI (bge-base-en-v1.5, 768-dim)
- **Vector Search**: Cloudflare Vectorize
- **Database**: Cloudflare D1 (SQLite + FTS5)
- **Protocol**: MCP (Model Context Protocol)

---

## License

ISC

Built with care for developers who forget their env var names.
