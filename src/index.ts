import { CloudflareVectorStore } from './cloudflare-vector-store';
import { sampleEnvVariables } from './sample-envs';
import type { Env } from './types';

// JSON-RPC 2.0 types for MCP
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = new CloudflareVectorStore(env);

    // CORS headers for MCP
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // MCP endpoint - JSON-RPC 2.0
      if (url.pathname === '/mcp' && request.method === 'POST') {
        const jsonRpcRequest: JsonRpcRequest = await request.json();
        const response = await handleJsonRpcRequest(jsonRpcRequest, store);

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

// MCP Tool Definitions
const MCP_TOOLS = [
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
          enum: ['ai_services', 'browser_automation', 'database', 'monitoring', 'deployment', 'auth', 'analytics', 'storage', 'email', 'sms', 'social', 'cms', 'payment', 'other'],
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
  {
    name: 'get_envs_for_services',
    description: 'Get all environment variables needed for multiple services. Use when setting up .env file for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of service names (e.g., ["Stripe", "SendGrid", "Supabase", "OpenAI"])',
        },
        includeOptional: {
          type: 'boolean',
          default: true,
          description: 'Include optional environment variables',
        },
      },
      required: ['services'],
    },
  },
];

/**
 * Handle JSON-RPC 2.0 MCP requests
 */
async function handleJsonRpcRequest(
  request: JsonRpcRequest,
  store: CloudflareVectorStore
): Promise<JsonRpcResponse> {
  const { jsonrpc, id, method, params } = request;

  // Helper to create success response
  const success = (result: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    result,
  });

  // Helper to create error response
  const error = (code: number, message: string, data?: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  });

  // MCP Protocol Methods
  switch (method) {
    // Initialize - handshake
    case 'initialize': {
      return success({
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'env-reference-mcp',
          version: '1.0.0',
        },
        instructions: `Use this server to find environment variables for any project.

WHEN TO USE:
- User asks about .env setup or environment variables
- Setting up a new project with external services
- User mentions API keys, secrets, or credentials needed
- Creating or updating .env files

HOW TO USE:
1. get_envs_for_services: BEST for .env setup - give list of services, get complete .env template
   Example: services=["Stripe","OpenAI","Supabase"] → returns ready .env file
2. search_env_variables: Natural language search (e.g., "email sending", "AI API")
3. get_env_by_name: Get details for specific var (e.g., "STRIPE_SECRET_KEY")
4. list_env_categories: Browse all categories and services

AUTO-DETECT PROJECT:
When user has package.json or mentions technologies, extract service names and call get_envs_for_services`,
      });
    }

    // Initialized notification (no response needed, but we acknowledge)
    case 'notifications/initialized':
    case 'initialized': {
      return success({});
    }

    // List available tools
    case 'tools/list': {
      return success({
        tools: MCP_TOOLS,
      });
    }

    // Call a tool
    case 'tools/call': {
      const toolName = (params as { name: string; arguments?: Record<string, unknown> })?.name;
      const args = (params as { name: string; arguments?: Record<string, unknown> })?.arguments || {};

      if (toolName === 'search_env_variables') {
        const results = await store.search(args.query as string, {
          category: args.category as string | undefined,
          service: args.service as string | undefined,
          requiredOnly: args.requiredOnly as boolean | undefined,
          limit: Math.min((args.limit as number) || 10, 50),
          minScore: args.minScore as number | undefined,
        });

        return success({
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
        });
      }

      if (toolName === 'get_env_by_name') {
        const envVar = await store.getByName(args.name as string);

        if (!envVar) {
          return success({
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Environment variable not found',
                name: args.name,
              }),
            }],
          });
        }

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify(envVar, null, 2),
          }],
        });
      }

      if (toolName === 'list_env_categories') {
        const stats = await store.getStats();

        return success({
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
        });
      }

      if (toolName === 'get_envs_for_services') {
        const services = args.services as string[];
        const includeOptional = args.includeOptional !== false;

        const allEnvs: Record<string, any[]> = {};
        let envTemplate = '# Generated .env template\n\n';

        for (const service of services) {
          const envVars = await store.getByService(service, includeOptional);
          if (envVars.length > 0) {
            allEnvs[service] = envVars;
            envTemplate += `# ${service}\n`;
            for (const env of envVars) {
              const prefix = env.required ? '' : '# ';
              envTemplate += `${prefix}${env.name}=${env.example || ''}\n`;
            }
            envTemplate += '\n';
          }
        }

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              services: services,
              found: Object.keys(allEnvs),
              notFound: services.filter(s => !allEnvs[s]),
              envVars: allEnvs,
              template: envTemplate,
            }, null, 2),
          }],
        });
      }

      return error(-32601, `Unknown tool: ${toolName}`);
    }

    // Ping - keepalive
    case 'ping': {
      return success({});
    }

    default:
      return error(-32601, `Method not found: ${method}`);
  }
}
