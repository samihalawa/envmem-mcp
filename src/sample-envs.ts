import type { EnvVariable } from './types';

/**
 * Sample environment variables for initial seeding
 * Add your own environment variables here
 */
export const sampleEnvVariables: EnvVariable[] = [
  // Browser Automation
  {
    name: 'BROWSERBASE_API_KEY',
    description: 'API key for Browserbase browser automation service. Provides cloud-hosted browsers for web scraping and testing.',
    category: 'browser_automation',
    service: 'Browserbase',
    required: false,
    example: 'bb_1234567890abcdef',
    keywords: ['browser', 'automation', 'scraping', 'testing', 'headless', 'chrome'],
    relatedTo: ['BROWSERBASE_PROJECT_ID', 'E2B_API_KEY'],
  },
  {
    name: 'BROWSERBASE_PROJECT_ID',
    description: 'Project ID for Browserbase workspace organization',
    category: 'browser_automation',
    service: 'Browserbase',
    required: false,
    example: 'proj_1234567890',
    keywords: ['browser', 'automation', 'project', 'workspace'],
    relatedTo: ['BROWSERBASE_API_KEY'],
  },
  {
    name: 'E2B_API_KEY',
    description: 'E2B API key for secure code execution environments and browser automation with sandboxed execution',
    category: 'browser_automation',
    service: 'E2B',
    required: false,
    example: 'e2b_1234567890',
    keywords: ['code execution', 'sandbox', 'browser', 'automation', 'security'],
    relatedTo: ['BROWSERBASE_API_KEY'],
  },
  {
    name: 'PLAYWRIGHT_BROWSERS_PATH',
    description: 'Path to Playwright browser binaries for automated testing',
    category: 'browser_automation',
    service: 'Playwright',
    required: false,
    example: '/usr/local/share/playwright',
    keywords: ['playwright', 'testing', 'browsers', 'e2e', 'automation'],
    relatedTo: [],
  },

  // AI Services
  {
    name: 'OPENAI_API_KEY',
    description: 'OpenAI API key for GPT models, embeddings, DALL-E, and Whisper. Required for AI code generation and chat.',
    category: 'ai_services',
    service: 'OpenAI',
    required: true,
    example: 'sk-1234567890abcdef',
    keywords: ['ai', 'gpt', 'code generation', 'chat', 'embeddings', 'dalle', 'whisper'],
    relatedTo: ['ANTHROPIC_API_KEY', 'OPENAI_ORG_ID'],
  },
  {
    name: 'OPENAI_ORG_ID',
    description: 'OpenAI organization ID for team billing and usage tracking',
    category: 'ai_services',
    service: 'OpenAI',
    required: false,
    example: 'org-1234567890',
    keywords: ['openai', 'organization', 'billing'],
    relatedTo: ['OPENAI_API_KEY'],
  },
  {
    name: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API key for Claude AI models. Provides access to Claude 3.5 Sonnet, Opus, and Haiku.',
    category: 'ai_services',
    service: 'Anthropic',
    required: false,
    example: 'sk-ant-1234567890',
    keywords: ['ai', 'claude', 'chat', 'code generation', 'reasoning'],
    relatedTo: ['OPENAI_API_KEY'],
  },

  // Database
  {
    name: 'DATABASE_URL',
    description: 'PostgreSQL database connection URL with credentials',
    category: 'database',
    service: 'PostgreSQL',
    required: true,
    example: 'postgresql://user:pass@host:5432/dbname',
    keywords: ['database', 'postgres', 'sql', 'connection'],
    relatedTo: ['REDIS_URL'],
  },
  {
    name: 'REDIS_URL',
    description: 'Redis connection URL for caching and session storage',
    category: 'database',
    service: 'Redis',
    required: false,
    example: 'redis://user:pass@host:6379',
    keywords: ['redis', 'cache', 'session', 'memory'],
    relatedTo: ['DATABASE_URL'],
  },

  // Monitoring
  {
    name: 'SENTRY_DSN',
    description: 'Sentry Data Source Name for error tracking and monitoring',
    category: 'monitoring',
    service: 'Sentry',
    required: false,
    example: 'https://abc@o123.ingest.sentry.io/456',
    keywords: ['error tracking', 'monitoring', 'debugging', 'alerts'],
    relatedTo: ['SENTRY_AUTH_TOKEN'],
  },
  {
    name: 'DATADOG_API_KEY',
    description: 'Datadog API key for infrastructure monitoring and logs',
    category: 'monitoring',
    service: 'Datadog',
    required: false,
    example: 'dd_1234567890',
    keywords: ['monitoring', 'metrics', 'logs', 'infrastructure'],
    relatedTo: [],
  },

  // Deployment
  {
    name: 'VERCEL_TOKEN',
    description: 'Vercel authentication token for API access and deployments',
    category: 'deployment',
    service: 'Vercel',
    required: false,
    example: 'vercel_1234567890',
    keywords: ['deployment', 'hosting', 'ci/cd', 'serverless'],
    relatedTo: ['VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'],
  },
  {
    name: 'CLOUDFLARE_API_TOKEN',
    description: 'Cloudflare API token for Workers, Pages, and CDN management',
    category: 'deployment',
    service: 'Cloudflare',
    required: false,
    example: 'cf_1234567890',
    keywords: ['cloudflare', 'cdn', 'workers', 'dns', 'deployment'],
    relatedTo: ['CLOUDFLARE_ACCOUNT_ID'],
  },

  // Auth
  {
    name: 'AUTH0_DOMAIN',
    description: 'Auth0 domain for authentication and identity management',
    category: 'auth',
    service: 'Auth0',
    required: false,
    example: 'myapp.auth0.com',
    keywords: ['auth', 'authentication', 'identity', 'login', 'sso'],
    relatedTo: ['AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET'],
  },
  {
    name: 'CLERK_PUBLISHABLE_KEY',
    description: 'Clerk publishable key for frontend authentication',
    category: 'auth',
    service: 'Clerk',
    required: false,
    example: 'pk_test_1234567890',
    keywords: ['auth', 'authentication', 'user management', 'frontend'],
    relatedTo: ['CLERK_SECRET_KEY'],
  },

  // Analytics
  {
    name: 'GOOGLE_ANALYTICS_ID',
    description: 'Google Analytics measurement ID for web analytics',
    category: 'analytics',
    service: 'Google Analytics',
    required: false,
    example: 'G-1234567890',
    keywords: ['analytics', 'tracking', 'metrics', 'web'],
    relatedTo: [],
  },
  {
    name: 'MIXPANEL_TOKEN',
    description: 'Mixpanel project token for product analytics',
    category: 'analytics',
    service: 'Mixpanel',
    required: false,
    example: 'mp_1234567890',
    keywords: ['analytics', 'product', 'events', 'tracking'],
    relatedTo: [],
  },

  // Storage
  {
    name: 'AWS_ACCESS_KEY_ID',
    description: 'AWS access key for S3 and other AWS services',
    category: 'storage',
    service: 'AWS',
    required: false,
    example: 'AKIA1234567890',
    keywords: ['aws', 's3', 'storage', 'cloud'],
    relatedTo: ['AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
  },
  {
    name: 'CLOUDFLARE_R2_ACCESS_KEY',
    description: 'Cloudflare R2 access key for S3-compatible object storage',
    category: 'storage',
    service: 'Cloudflare',
    required: false,
    example: 'r2_1234567890',
    keywords: ['storage', 'r2', 'object storage', 's3'],
    relatedTo: ['CLOUDFLARE_R2_SECRET_KEY'],
  },
];
