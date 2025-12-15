import { CloudflareVectorStore } from './cloudflare-vector-store';
import { sampleEnvVariables } from './sample-envs';
import type { Env, MCPRequest, MCPResponse } from './types';

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
        const result = await store.bulkInsert(sampleEnvVariables);

        return new Response(JSON.stringify({
          success: true,
          message: `Seeded ${result.inserted} environment variables (${result.indexed} indexed)`,
          inserted: result.inserted,
          indexed: result.indexed,
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

  // Queue consumer disabled - requires paid plan
  // Using synchronous embedding generation in CloudflareVectorStore.insertEnvVariable()
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
