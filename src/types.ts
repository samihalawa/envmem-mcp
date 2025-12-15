/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  // QUEUE: Queue; // Requires paid plan - using sync embedding instead
  ENVIRONMENT: string;
}

/**
 * Queue message for async embedding generation
 */
export interface QueueMessage {
  envVariableId: number;
  name: string;
  text: string;
  retryCount?: number;
}

/**
 * Environment variable metadata
 */
export interface EnvVariable {
  id?: number;
  name: string;
  description: string;
  category: 'ai_services' | 'browser_automation' | 'database' | 'monitoring' | 'deployment' | 'auth' | 'analytics' | 'storage' | 'other';
  service: string;
  required: boolean;
  example?: string;
  keywords: string[];
  relatedTo: string[];
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Search result with scoring
 */
export interface SearchResult {
  env: EnvVariable;
  score: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

/**
 * Search options
 */
export interface SearchOptions {
  category?: EnvVariable['category'];
  service?: string;
  requiredOnly?: boolean;
  limit?: number;
  minScore?: number;
}

/**
 * MCP tool request
 */
export interface MCPRequest {
  method: string;
  params: {
    name?: string;
    arguments?: Record<string, any>;
  };
}

/**
 * MCP tool response
 */
export interface MCPResponse {
  content: Array<{
    type: 'text' | 'resource';
    text?: string;
    resource?: {
      uri: string;
      mimeType: string;
      text: string;
    };
  }>;
}
