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
/**
 * User authentication context
 */
export interface AuthContext {
  userId: string;
  apiKey?: string;
}

export interface EnvVariable {
  id?: number;
  userId?: string;  // For multi-tenant isolation
  name: string;
  description: string;
  category: 'ai_services' | 'browser_automation' | 'database' | 'monitoring' | 'deployment' | 'auth' | 'analytics' | 'storage' | 'email' | 'sms' | 'social' | 'cms' | 'payment' | 'other';
  service: string;
  required: boolean;
  example?: string;
  keywords: string[];
  relatedTo: string[];
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Project for organizing env variables
 */
export interface Project {
  id?: number;
  userId?: string;
  name: string;
  repoUrl?: string;
  tags: string[];
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Link between env variable and project with environment support
 */
export interface EnvProjectLink {
  id?: number;
  envVariableId: number;
  projectId: number;
  environment: 'dev' | 'staging' | 'prod' | 'default';
  valueOverride?: string;
  createdAt?: number;
}

/**
 * Env variable with project context
 */
export interface EnvWithProject extends EnvVariable {
  projectName?: string;
  environment?: string;
  valueOverride?: string;
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
