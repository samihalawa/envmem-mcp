# Deployment Guide - env-reference-mcp

Complete deployment verification and testing guide for Cloudflare Workers.

## ✅ Pre-Deployment Checklist

### 1. File Structure Verification
```
✅ wrangler.toml - Cloudflare Workers configuration
✅ package.json - Dependencies and scripts
✅ tsconfig.json - TypeScript configuration
✅ src/index.ts - Main Worker entry point with MCP and queue handlers
✅ src/types.ts - TypeScript interfaces for Env and QueueMessage
✅ src/cloudflare-vector-store.ts - Vector store with async queue pattern
✅ src/sample-envs.ts - 20+ sample environment variables
✅ migrations/0001_initial_schema.sql - D1 schema with tracking tables
✅ README.md - Complete documentation
✅ IMPROVEMENTS.md - Architecture improvements documentation
✅ .gitignore - Proper exclusions
```

### 2. Critical Configuration Verification

**wrangler.toml**:
- ✅ `nodejs_compat` flag (CRITICAL for MCP SDK)
- ✅ Workers AI binding
- ✅ D1 database binding (needs database_id)
- ✅ Vectorize binding
- ✅ Queue producer/consumer configuration
- ✅ Observability enabled

**package.json**:
- ✅ MCP SDK dependency (@modelcontextprotocol/sdk ^1.20.0)
- ✅ Zod for validation (^3.25.46)
- ✅ Cloudflare Workers types (@cloudflare/workers-types)
- ✅ Setup scripts for resource creation

## 🚀 Deployment Steps

### Step 1: Install Dependencies
```bash
npm install
```

**Expected Output**: All dependencies installed successfully

### Step 2: Create Cloudflare Resources

#### Option A: Automated Setup (Recommended)
```bash
npm run setup
```

This runs:
1. `wrangler d1 create env-reference-db`
2. `wrangler vectorize create env-embeddings --dimensions=768 --metric=cosine`
3. `wrangler queues create env-indexing-queue`

#### Option B: Manual Setup
```bash
# Create D1 database
wrangler d1 create env-reference-db
# Save the database_id from output

# Create Vectorize index
wrangler vectorize create env-embeddings --dimensions=768 --metric=cosine

# Create Queue
wrangler queues create env-indexing-queue
```

**CRITICAL**: Copy the `database_id` from D1 creation output and update `wrangler.toml:15`

### Step 3: Update Configuration

Edit `wrangler.toml` line 15:
```toml
database_id = "abc-123-def-456-ghi"  # Replace with your actual database_id
```

### Step 4: Run Database Migrations
```bash
wrangler d1 migrations apply env-reference-db
```

**Expected Output**:
```
Migrations to be applied:
  - 0001_initial_schema.sql
✔ Applying 0001_initial_schema.sql
```

**Verify Schema**:
```bash
wrangler d1 execute env-reference-db --command "SELECT name FROM sqlite_master WHERE type='table'"
```

**Expected Tables**:
- env_variables
- env_fts
- indexing_status
- search_analytics

### Step 5: Deploy to Cloudflare Workers
```bash
wrangler deploy
```

**Expected Output**:
```
✨ Successfully deployed env-reference-mcp
   https://env-reference-mcp.<your-account>.workers.dev
```

## 🧪 Post-Deployment Testing

### Test 1: Health Check
```bash
curl https://env-reference-mcp.<your-account>.workers.dev/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "service": "env-reference-mcp",
  "version": "1.0.0",
  "stats": {
    "total": 0,
    "required": 0,
    "byCategory": {},
    "byService": {}
  }
}
```

### Test 2: Seed Sample Data
```bash
curl -X POST https://env-reference-mcp.<your-account>.workers.dev/seed
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Seeded 20 environment variables"
}
```

### Test 3: Check Indexing Status
```bash
curl https://env-reference-mcp.<your-account>.workers.dev/stats
```

**Expected Response** (after ~30 seconds for queue processing):
```json
{
  "total": 20,
  "required": 15,
  "byCategory": {
    "browser_automation": 3,
    "ai_services": 5,
    "database": 4,
    ...
  }
}
```

**Verify Indexing Progress**:
```bash
wrangler d1 execute env-reference-db --command \
  "SELECT status, COUNT(*) as count FROM indexing_status GROUP BY status"
```

**Expected Output** (initially):
```
status    count
queued    20
```

**After queue processing** (~30 seconds):
```
status    count
indexed   20
```

### Test 4: Semantic Search
```bash
curl "https://env-reference-mcp.<your-account>.workers.dev/search?q=browser%20automation&limit=3"
```

**Expected Response** (after indexing completes):
```json
{
  "query": "browser automation",
  "results": [
    {
      "env": {
        "name": "BROWSERBASE_API_KEY",
        "description": "BrowserBase cloud browser API key...",
        "category": "browser_automation",
        "service": "BrowserBase"
      },
      "score": 0.856,
      "matchType": "hybrid"
    },
    {
      "env": {
        "name": "E2B_API_KEY",
        "description": "E2B sandboxed browser environments...",
        "category": "browser_automation",
        "service": "E2B"
      },
      "score": 0.823,
      "matchType": "hybrid"
    }
  ]
}
```

### Test 5: MCP Protocol
```bash
# Test tools/list endpoint
curl -X POST https://env-reference-mcp.<your-account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list"}'
```

**Expected Response**:
```json
{
  "content": [{
    "type": "text",
    "text": "{\"tools\":[{\"name\":\"search_env_variables\",...}]}"
  }]
}
```

### Test 6: MCP Search
```bash
curl -X POST https://env-reference-mcp.<your-account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "search_env_variables",
      "arguments": {
        "query": "AI code generation",
        "limit": 3
      }
    }
  }'
```

**Expected Response** (after indexing):
```json
{
  "content": [{
    "type": "text",
    "text": "{\n  \"query\": \"AI code generation\",\n  \"results\": [\n    {\n      \"name\": \"OPENAI_API_KEY\",\n      \"relevanceScore\": \"0.892\",\n      ...\n    }\n  ]\n}"
  }]
}
```

## 🔍 Monitoring & Troubleshooting

### Check Queue Consumer Status
```bash
wrangler queues consumer get env-indexing-queue
```

### View Real-Time Logs
```bash
wrangler tail
```

**Look for**:
- ✅ `Queued: BROWSERBASE_API_KEY (id: 1)`
- ✅ `✅ Indexed: BROWSERBASE_API_KEY (vector: env-1)`

### Check Database Content
```bash
# View all environment variables
wrangler d1 execute env-reference-db --command \
  "SELECT id, name, category FROM env_variables LIMIT 5"

# Check indexing status
wrangler d1 execute env-reference-db --command \
  "SELECT env_variable_id, status, retry_count FROM indexing_status LIMIT 5"

# View search analytics
wrangler d1 execute env-reference-db --command \
  "SELECT query, result_count FROM search_analytics LIMIT 5"
```

### Verify Vectorize Index
```bash
wrangler vectorize get env-embeddings
```

**Expected Output**:
```
Index: env-embeddings
Dimensions: 768
Metric: cosine
Vectors: 20 (after seeding and queue processing)
```

## ⚠️ Common Issues

### Issue 1: Embeddings Not Generating
**Symptom**: All indexing_status records stuck in 'queued' state

**Diagnosis**:
```bash
wrangler d1 execute env-reference-db --command \
  "SELECT status, COUNT(*) FROM indexing_status GROUP BY status"
```

**Solution**:
- Check queue consumer is running: `wrangler queues consumer get env-indexing-queue`
- View logs: `wrangler tail` and look for errors
- Verify Workers AI binding is correct in wrangler.toml

### Issue 2: MCP SDK Not Working
**Symptom**: Error about missing Node.js APIs

**Solution**:
- Verify `compatibility_flags = ["nodejs_compat"]` in wrangler.toml:4
- Redeploy: `wrangler deploy`

### Issue 3: Database Not Found
**Symptom**: "D1 database not found" error

**Solution**:
- Verify `database_id` in wrangler.toml:15 matches the actual database ID
- Run: `wrangler d1 list` to see all databases
- Update wrangler.toml with correct database_id

### Issue 4: Search Returns No Results
**Symptom**: Empty results array

**Diagnosis**:
```bash
# Check if vectors are indexed
wrangler d1 execute env-reference-db --command \
  "SELECT COUNT(*) as indexed FROM env_variables WHERE vector_id IS NOT NULL"
```

**Solution**:
- Wait for queue processing (check logs: `wrangler tail`)
- Verify indexing status: all should be 'indexed'
- If failed, check error_message in indexing_status table

### Issue 5: High Error Rate
**Symptom**: Many 'failed' status in indexing_status

**Diagnosis**:
```bash
wrangler d1 execute env-reference-db --command \
  "SELECT error_message, retry_count FROM indexing_status WHERE status='failed'"
```

**Solution**:
- Check Workers AI quota limits in Cloudflare dashboard
- Review error messages for specific issues
- Consider implementing rate limiting if hitting quota

## 📊 Performance Expectations

**After Successful Deployment**:

| Operation | Expected Performance |
|-----------|---------------------|
| Insert (queue) | 20-30ms (instant response) |
| Embedding generation (background) | 180-250ms |
| Search query (hybrid) | 40-60ms |
| Cold start | ~100ms |

**Indexing Timeline**:
- Seed request: Instant (20-30ms)
- Queue processing: 10-20 seconds for 20 items
- First search: Available immediately after indexing

## 🎯 Next Steps

### 1. Add Your Own Environment Variables
Edit `src/sample-envs.ts` and add your variables:
```typescript
{
  name: 'YOUR_API_KEY',
  description: 'Detailed description for semantic matching',
  category: 'ai_services',
  service: 'YourService',
  required: true,
  keywords: ['keyword1', 'keyword2'],
}
```

Redeploy:
```bash
wrangler deploy
curl -X POST https://your-worker.workers.dev/seed
```

### 2. Integrate with MCP Clients
Configure in your MCP client (e.g., Claude Code):
```json
{
  "mcpServers": {
    "env-reference": {
      "url": "https://env-reference-mcp.<your-account>.workers.dev/mcp",
      "type": "http"
    }
  }
}
```

### 3. Enable AI Gateway (Optional)
1. Create AI Gateway in Cloudflare dashboard
2. Uncomment line 9 in wrangler.toml: `gateway = "your-gateway-id"`
3. Redeploy

**Benefits**:
- Cost tracking per embedding call
- Request/response caching
- Automatic retry on failures

### 4. Monitor Usage
- Cloudflare Dashboard → Workers → env-reference-mcp → Metrics
- Check queue processing times
- Monitor D1 database size
- Review search analytics table

## ✅ Success Criteria

Your deployment is successful when:
- ✅ Health endpoint returns "healthy" status
- ✅ Seed creates 20 environment variables
- ✅ All 20 items show 'indexed' status within 30 seconds
- ✅ Search returns relevant results with hybrid scores
- ✅ MCP tools/list returns 3 tools
- ✅ MCP search_env_variables works correctly
- ✅ Logs show successful queue processing
- ✅ No errors in wrangler tail output

## 📚 Architecture Summary

**100% Cloudflare Services**:
- ✅ Workers AI: BGE-base-en-v1.5 embeddings (768-dim)
- ✅ Vectorize: Semantic similarity search
- ✅ D1: SQLite with FTS5 keyword search
- ✅ Queue: Async background processing
- ✅ Observability: Request logging and monitoring

**Production-Ready Features**:
- ✅ Async queue pattern (10x faster UX)
- ✅ Exponential backoff retry (60s → 120s → 240s)
- ✅ Status tracking (queued → processing → indexed/failed)
- ✅ Search analytics
- ✅ Hybrid scoring (60% semantic + 30% keyword + 10% metadata)

**MCP Integration**:
- ✅ 3 tools: search_env_variables, get_env_by_name, list_env_categories
- ✅ HTTP and MCP protocol support
- ✅ Natural language queries
- ✅ Category and service filtering
