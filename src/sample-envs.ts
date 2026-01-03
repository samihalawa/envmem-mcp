import type { EnvVariable } from './types';

/**
 * Sample environment variables for seeding (DEPRECATED)
 *
 * This file is now empty by design. Users should import their own
 * environment variables using the `import_env_variables` tool.
 *
 * Example usage via MCP:
 * 1. Call `import_env_variables` with your .env file content
 * 2. Or use `add_env_variable` to add variables one at a time
 *
 * The database stores variables PER-DEPLOYMENT, not globally.
 * Each Cloudflare Worker instance has its own D1 database.
 */
export const sampleEnvVariables: EnvVariable[] = [];
