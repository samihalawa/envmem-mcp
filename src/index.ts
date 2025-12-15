import { CloudflareVectorStore } from './cloudflare-vector-store';
import { sampleEnvVariables } from './sample-envs';
import type { Env, MCPRequest, MCPResponse, QueueMessage } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = new CloudflareVectorStore(env);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // MCP endpoint
      if (url.pathname === '/mcp' && request.method === 'POST') {
        const mcpRequest: MCPRequest = await request.json();
        const response = await handleMCPRequest(mcpRequest, store);

        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Seed endpoint (development only)
      if (url.pathname === '/seed' && request.method === 'POST') {
        await store.bulkInsert(sampleEnvVariables);

        return new Response(JSON.stringify({
          success: true,
          message: `Seeded ${sampleEnvVariables.length} environment variables`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Stats endpoint
      if (url.pathname === '/stats' && request.method === 'GET') {
        const stats = await store.getStats();

        return new Response(JSON.stringify(stats), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Search endpoint (HTTP API alternative to MCP)
      if (url.pathname === '/search' && request.method === 'GET') {
        const query = url.searchParams.get('q');
        if (!query) {
          return new Response(JSON.stringify({ error: 'Query parameter "q" required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const options = {
          category: url.searchParams.get('category') as any,
          service: url.searchParams.get('service') || undefined,
          requiredOnly: url.searchParams.get('required') === 'true',
          limit: parseInt(url.searchParams.get('limit') || '10'),
          minScore: parseFloat(url.searchParams.get('minScore') || '0'),
        };

        const results = await store.search(query, options);

        return new Response(JSON.stringify({ query, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Health check
      if (url.pathname === '/' || url.pathname === '/health') {
        const stats = await store.getStats();

        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'env-reference-mcp',
          version: '1.0.0',
          stats,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Request error:', error);

      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },

  /**
   * Queue consumer for async embedding generation
   * Pattern from: github.com/Foundation42/engram
   */
  async queue(batch: MessageBatch<QueueMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Processing ${batch.messages.length} messages from queue`);

    for (const message of batch.messages) {
      try {
        const { envVariableId, name, text } = message.body;

        // Update status to processing
        await env.DB.prepare(
          'UPDATE indexing_status SET status = ? WHERE env_variable_id = ?'
        ).bind('processing', envVariableId).run();

        // Generate embedding using Workers AI
        const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [text],
        }) as { data: number[][] };

        const vector = embeddings.data[0];

        // Insert into Vectorize
        const vectorId = `env-${envVariableId}`;
        await env.VECTORIZE.insert([{
          id: vectorId,
          values: vector,
          metadata: {
            envVariableId,
            name,
            indexedAt: Date.now(),
          },
        }]);

        // Update env_variables with vector_id and indexed_at
        await env.DB.prepare(
          'UPDATE env_variables SET vector_id = ?, indexed_at = ? WHERE id = ?'
        ).bind(vectorId, Math.floor(Date.now() / 1000), envVariableId).run();

        // Update status to indexed
        await env.DB.prepare(
          'UPDATE indexing_status SET status = ?, indexed_timestamp = ? WHERE env_variable_id = ?'
        ).bind('indexed', Math.floor(Date.now() / 1000), envVariableId).run();

        // Acknowledge successful processing
        message.ack();

        console.log(`✅ Indexed: ${name} (vector: ${vectorId})`);
      } catch (error) {
        console.error('Queue processing error:', error);

        const retryCount = message.body.retryCount || 0;

        // Update status to failed if max retries exceeded
        if (retryCount >= 3) {
          await env.DB.prepare(
            'UPDATE indexing_status SET status = ?, error_message = ?, retry_count = ? WHERE env_variable_id = ?'
          ).bind(
            'failed',
            error instanceof Error ? error.message : 'Unknown error',
            retryCount,
            message.body.envVariableId
          ).run();

          message.ack(); // Don't retry anymore
        } else {
          // Retry with incremented count
          message.retry({
            delaySeconds: Math.min(60 * Math.pow(2, retryCount), 3600), // Exponential backoff
          });

          await env.DB.prepare(
            'UPDATE indexing_status SET retry_count = ? WHERE env_variable_id = ?'
          ).bind(retryCount + 1, message.body.envVariableId).run();
        }
      }
    }
  },
};

/**
 * Handle MCP tool requests
 */
async function handleMCPRequest(
  request: MCPRequest,
  store: CloudflareVectorStore
): Promise<MCPResponse> {
  const { method, params } = request;

  // Handle MCP tools/list
  if (method === 'tools/list') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          tools: [
            {
              name: 'search_env_variables',
              description: 'Search environment variables using natural language. Example: "browser automation" returns Browserbase, E2B, Playwright variables.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Natural language search query (e.g., "AI code generation", "monitoring tools")',
                  },
                  category: {
                    type: 'string',
                    enum: ['ai_services', 'browser_automation', 'database', 'monitoring', 'deployment', 'auth', 'analytics', 'storage', 'other'],
                    description: 'Optional: Filter by category',
                  },
                  service: {
                    type: 'string',
                    description: 'Optional: Filter by service name',
                  },
                  requiredOnly: {
                    type: 'boolean',
                    description: 'Optional: Only return required environment variables',
                  },
                  limit: {
                    type: 'number',
                    default: 10,
                    description: 'Maximum number of results (1-50)',
                  },
                },
                required: ['query'],
              },
            },
            {
              name: 'get_env_by_name',
              description: 'Get environment variable details by exact name',
              inputSchema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Exact environment variable name (e.g., "OPENAI_API_KEY")',
                  },
                },
                required: ['name'],
              },
            },
            {
              name: 'list_env_categories',
              description: 'List all available environment variable categories with counts',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        }),
      }],
    };
  }

  // Handle MCP tools/call
  if (method === 'tools/call') {
    const toolName = params.name;
    const args = params.arguments || {};

    if (toolName === 'search_env_variables') {
      const results = await store.search(args.query, {
        category: args.category,
        service: args.service,
        requiredOnly: args.requiredOnly,
        limit: Math.min(args.limit || 10, 50),
        minScore: args.minScore,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            filters: {
              category: args.category,
              service: args.service,
              requiredOnly: args.requiredOnly,
            },
            results: results.map(r => ({
              name: r.env.name,
              description: r.env.description,
              category: r.env.category,
              service: r.env.service,
              required: r.env.required,
              example: r.env.example,
              relatedTo: r.env.relatedTo,
              relevanceScore: r.score.toFixed(3),
              matchType: r.matchType,
            })),
          }, null, 2),
        }],
      };
    }

    if (toolName === 'get_env_by_name') {
      const envVar = await store.getByName(args.name);

      if (!envVar) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Environment variable not found',
              name: args.name,
            }),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(envVar, null, 2),
        }],
      };
    }

    if (toolName === 'list_env_categories') {
      const stats = await store.getStats();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: stats.total,
            required: stats.required,
            categories: Object.entries(stats.byCategory).map(([category, count]) => ({
              category,
              count,
            })),
            services: Object.entries(stats.byService).map(([service, count]) => ({
              service,
              count,
            })),
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: 'Unknown tool' }),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: 'Unknown method' }),
    }],
  };
}
