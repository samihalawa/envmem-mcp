import { CloudflareVectorStore } from './cloudflare-vector-store';
import { sampleEnvVariables } from './sample-envs';
import type { Env, EnvVariable, AuthContext } from './types';

/**
 * Extract API key and derive userId from request
 * Simple approach: hash the API key to create a stable userId
 */
function getAuthContext(request: Request): AuthContext {
  // Try multiple auth methods
  const url = new URL(request.url);
  const apiKey =
    request.headers.get('x-api-key') ||
    request.headers.get('authorization')?.replace('Bearer ', '') ||
    url.searchParams.get('apikey') ||
    url.searchParams.get('api_key');

  if (!apiKey) {
    // Anonymous user - backward compatible
    return { userId: 'anonymous' };
  }

  // Create stable userId from API key using simple hash
  // For production, you'd validate against a database
  const userId = hashApiKey(apiKey);
  return { userId, apiKey };
}

/**
 * Simple hash function to create userId from API key
 * In production, you'd use crypto.subtle.digest
 */
function hashApiKey(apiKey: string): string {
  let hash = 0;
  for (let i = 0; i < apiKey.length; i++) {
    const char = apiKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `user_${Math.abs(hash).toString(36)}`;
}

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
    const auth = getAuthContext(request);
    const store = new CloudflareVectorStore(env, auth);

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

      // Debug endpoint
      if (url.pathname === '/debug') {
        const debugInfo = await store.getDebugInfo();

        return new Response(JSON.stringify(debugInfo), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        const stats = await store.getStats();

        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'envmem',
          version: '1.2.0',
          userId: auth.userId,
          authenticated: auth.userId !== 'anonymous',
          stats,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // API info endpoint (for programmatic access)
      if (url.pathname === '/api') {
        const stats = await store.getStats();

        return new Response(JSON.stringify({
          name: 'envmem',
          version: '1.2.0',
          description: 'Personal environment variable memory with semantic search',
          endpoints: {
            mcp: '/mcp',
            search: '/search?q=<query>',
            health: '/health',
            stats: '/stats',
          },
          auth: {
            userId: auth.userId,
            authenticated: auth.userId !== 'anonymous',
          },
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
  // ==================== MANAGEMENT TOOLS ====================
  {
    name: 'import_env_variables',
    description: 'Import environment variables from .env format text. Parses NAME=value pairs with optional # comments for descriptions. Use this to populate YOUR personal env reference database.',
    inputSchema: {
      type: 'object',
      properties: {
        envText: {
          type: 'string',
          description: 'The .env file content to import. Format: NAME=value with optional # comments',
        },
        clearExisting: {
          type: 'boolean',
          default: false,
          description: 'If true, delete all existing variables before importing',
        },
      },
      required: ['envText'],
    },
  },
  {
    name: 'add_env_variable',
    description: 'Add a single environment variable to your reference database',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Variable name (e.g., "OPENAI_API_KEY")',
        },
        description: {
          type: 'string',
          description: 'What this variable is used for',
        },
        category: {
          type: 'string',
          enum: ['ai_services', 'browser_automation', 'database', 'monitoring', 'deployment', 'auth', 'analytics', 'storage', 'email', 'sms', 'social', 'cms', 'payment', 'other'],
          description: 'Category for grouping',
        },
        service: {
          type: 'string',
          description: 'Service name (e.g., "OpenAI", "Stripe")',
        },
        required: {
          type: 'boolean',
          default: false,
          description: 'Is this variable required?',
        },
        example: {
          type: 'string',
          description: 'Example value (will be sanitized)',
        },
      },
      required: ['name', 'description', 'service'],
    },
  },
  {
    name: 'delete_env_variable',
    description: 'Delete an environment variable from your reference database by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact name of the variable to delete',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'clear_all_env_variables',
    description: 'Delete ALL environment variables from the database. Use with caution!',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['confirm'],
    },
  },
  // ==================== PROJECT MANAGEMENT TOOLS ====================
  {
    name: 'create_project',
    description: 'Create a project to organize environment variables. Projects can be linked to repos and tagged.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name (e.g., "my-saas-app", "autoclient")',
        },
        repoUrl: {
          type: 'string',
          description: 'Optional: GitHub/GitLab repo URL',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Tags for categorization (e.g., ["saas", "nextjs", "stripe"])',
        },
        description: {
          type: 'string',
          description: 'Optional: Project description',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_projects',
    description: 'List all your projects',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'link_env_to_project',
    description: 'Link an environment variable to a project. Optionally specify environment (dev/staging/prod) and override value.',
    inputSchema: {
      type: 'object',
      properties: {
        envName: {
          type: 'string',
          description: 'Environment variable name (e.g., "STRIPE_SECRET_KEY")',
        },
        projectName: {
          type: 'string',
          description: 'Project name to link to',
        },
        environment: {
          type: 'string',
          enum: ['dev', 'staging', 'prod', 'default'],
          default: 'default',
          description: 'Environment (dev/staging/prod/default)',
        },
        valueOverride: {
          type: 'string',
          description: 'Optional: Different value for this project/environment combo',
        },
      },
      required: ['envName', 'projectName'],
    },
  },
  {
    name: 'link_services_to_project',
    description: 'Bulk link all envs from multiple services to a project. Use when setting up a new project that uses Stripe, Supabase, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        services: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of services (e.g., ["Stripe", "Supabase", "OpenAI"])',
        },
        environment: {
          type: 'string',
          enum: ['dev', 'staging', 'prod', 'default'],
          default: 'default',
          description: 'Environment to link to',
        },
      },
      required: ['projectName', 'services'],
    },
  },
  {
    name: 'get_envs_for_project',
    description: 'Get all environment variables for a project, optionally filtered by environment. Returns ready-to-use .env content.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        environment: {
          type: 'string',
          enum: ['dev', 'staging', 'prod', 'default'],
          description: 'Optional: Filter by environment',
        },
        format: {
          type: 'string',
          enum: ['json', 'env', 'env_minimal'],
          default: 'env',
          description: 'Output format: json (structured), env (with comments), env_minimal (no comments)',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'fill_env_example',
    description: 'Parse a .env.example file and fill it with your stored values. Auto-links matched envs to the project.',
    inputSchema: {
      type: 'object',
      properties: {
        envExampleContent: {
          type: 'string',
          description: 'Content of your .env.example file',
        },
        projectName: {
          type: 'string',
          description: 'Project name (will be created if not exists)',
        },
      },
      required: ['envExampleContent', 'projectName'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project and all its env links (does NOT delete the env variables themselves)',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['projectName', 'confirm'],
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
          name: 'envmem',
          version: '1.2.0',
        },
        instructions: `EnvMem v1.2 - Personal environment variable memory with project management.

AUTHENTICATION:
- Pass API key via x-api-key header, Bearer token, or ?api_key= query param
- Each API key gets isolated storage (multi-tenant)
- No API key = anonymous (shared) storage

FIRST TIME SETUP:
1. Import your .env file: import_env_variables(envText="<your .env content>")
2. Or add one at a time: add_env_variable(name, description, service, ...)

SEARCHING:
- search_env_variables: Natural language search (e.g., "email sending", "AI API")
- get_env_by_name: Get details for specific var (e.g., "STRIPE_SECRET_KEY")
- get_envs_for_services: Get all vars for services (e.g., ["Stripe","OpenAI"])
- list_env_categories: Browse all categories and counts

PROJECT MANAGEMENT (NEW!):
- create_project: Create a project to organize envs (with optional repo URL and tags)
- list_projects: List all your projects
- link_env_to_project: Link an env var to a project (with dev/staging/prod support)
- link_services_to_project: Bulk link all envs from services to a project
- get_envs_for_project: Get all envs for a project as ready-to-use .env file
- fill_env_example: Parse .env.example and fill with your stored values
- delete_project: Delete a project and its links

TYPICAL WORKFLOW:
1. Import your envs once: import_env_variables(envText="...")
2. Create project: create_project(name="my-app", repoUrl="github.com/me/my-app")
3. Link services: link_services_to_project(projectName="my-app", services=["Stripe","Supabase"])
4. Get .env file: get_envs_for_project(projectName="my-app", environment="prod")

OR use fill_env_example to auto-fill from .env.example!`,
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
          category: args.category as EnvVariable['category'] | undefined,
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

      // ==================== MANAGEMENT TOOLS ====================

      if (toolName === 'import_env_variables') {
        const envText = args.envText as string;
        const clearExisting = args.clearExisting as boolean;

        // Optionally clear existing data
        if (clearExisting) {
          await store.deleteAll();
        }

        // Parse and import
        const parsed = store.parseEnvText(envText);
        const result = await store.bulkInsert(parsed as EnvVariable[]);

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Imported ${result.inserted} environment variables (${result.indexed} indexed)`,
              parsed: parsed.length,
              inserted: result.inserted,
              indexed: result.indexed,
              clearedExisting: clearExisting,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'add_env_variable') {
        const envVar: EnvVariable = {
          name: args.name as string,
          description: args.description as string,
          category: (args.category as EnvVariable['category']) || 'other',
          service: args.service as string,
          required: args.required as boolean || false,
          example: args.example as string || '',
          keywords: [],
          relatedTo: [],
        };

        const result = await store.insertEnvVariable(envVar);

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added ${envVar.name}`,
              id: result.id,
              indexed: result.indexed,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'delete_env_variable') {
        const name = args.name as string;
        const deleted = await store.deleteByName(name);

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: deleted,
              message: deleted ? `Deleted ${name}` : `Variable ${name} not found`,
              name,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'clear_all_env_variables') {
        const confirm = args.confirm as boolean;

        if (!confirm) {
          return success({
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: 'Deletion cancelled. Set confirm=true to delete all variables.',
              }, null, 2),
            }],
          });
        }

        const result = await store.deleteAll();

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Deleted ${result.deleted} environment variables`,
              deleted: result.deleted,
            }, null, 2),
          }],
        });
      }

      // ==================== PROJECT MANAGEMENT TOOLS ====================

      if (toolName === 'create_project') {
        const result = await store.createProject({
          name: args.name as string,
          repoUrl: args.repoUrl as string | undefined,
          tags: (args.tags as string[]) || [],
          description: args.description as string | undefined,
          userId: undefined, // Set by store based on auth
        });

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Created project: ${args.name}`,
              projectId: result.id,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'list_projects') {
        const projects = await store.listProjects();

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: projects.length,
              projects: projects.map(p => ({
                name: p.name,
                repoUrl: p.repoUrl,
                tags: p.tags,
                description: p.description,
              })),
            }, null, 2),
          }],
        });
      }

      if (toolName === 'link_env_to_project') {
        const result = await store.linkEnvToProject(
          args.envName as string,
          args.projectName as string,
          (args.environment as 'dev' | 'staging' | 'prod' | 'default') || 'default',
          args.valueOverride as string | undefined
        );

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              message: result.success
                ? `Linked ${args.envName} to ${args.projectName} (${args.environment || 'default'})`
                : `Failed to link - env variable "${args.envName}" not found`,
              linkId: result.linkId,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'link_services_to_project') {
        const result = await store.linkServiceEnvsToProject(
          args.projectName as string,
          args.services as string[],
          (args.environment as 'dev' | 'staging' | 'prod' | 'default') || 'default'
        );

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Linked ${result.linked} env variables to ${args.projectName}`,
              linked: result.linked,
              byService: result.services,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'get_envs_for_project') {
        const format = (args.format as string) || 'env';
        const environment = args.environment as 'dev' | 'staging' | 'prod' | 'default' | undefined;

        if (format === 'json') {
          const envs = await store.getEnvsForProject(args.projectName as string, environment);

          return success({
            content: [{
              type: 'text',
              text: JSON.stringify({
                project: args.projectName,
                environment: environment || 'all',
                count: envs.length,
                envs: envs.map(e => ({
                  name: e.name,
                  value: e.valueOverride || e.example || '',
                  service: e.service,
                  required: e.required,
                  environment: e.environment,
                })),
              }, null, 2),
            }],
          });
        }

        // Generate .env file format
        const includeComments = format !== 'env_minimal';
        const envFile = await store.generateEnvFile(
          args.projectName as string,
          environment || 'default',
          includeComments
        );

        return success({
          content: [{
            type: 'text',
            text: envFile,
          }],
        });
      }

      if (toolName === 'fill_env_example') {
        const result = await store.matchEnvExample(
          args.envExampleContent as string,
          args.projectName as string
        );

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              project: args.projectName,
              matched: result.matched.length,
              missing: result.missing,
              matchedVars: result.matched.map(e => e.name),
              missingVars: result.missing,
              filledTemplate: result.template,
            }, null, 2),
          }],
        });
      }

      if (toolName === 'delete_project') {
        if (!args.confirm) {
          return success({
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: 'Deletion cancelled. Set confirm=true to delete.',
              }, null, 2),
            }],
          });
        }

        const deleted = await store.deleteProject(args.projectName as string);

        return success({
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: deleted,
              message: deleted
                ? `Deleted project: ${args.projectName}`
                : `Project not found: ${args.projectName}`,
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
