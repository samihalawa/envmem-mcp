#!/usr/bin/env node

/**
 * EnvMem CLI - MCP Server for environment variable management
 *
 * This CLI connects to the EnvMem Cloudflare Worker and provides
 * a stdio-based MCP interface for use with Claude and other AI assistants.
 *
 * Usage:
 *   npx envmem --api-key YOUR_API_KEY
 *
 * Environment variables:
 *   ENVMEM_API_KEY - Your API key for authentication
 *   ENVMEM_URL - Custom server URL (default: https://envmem.trigox.workers.dev)
 */

import { createInterface } from 'readline';

const DEFAULT_URL = 'https://envmem.trigox.workers.dev/mcp';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    apiKey: process.env.ENVMEM_API_KEY || '',
    url: process.env.ENVMEM_URL || DEFAULT_URL,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-key' && args[i + 1]) {
      config.apiKey = args[++i];
    } else if (args[i] === '--url' && args[i + 1]) {
      config.url = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.error(`
EnvMem - Personal environment variable memory with semantic search

Usage:
  npx envmem [options]

Options:
  --api-key KEY   Your API key for authentication (or set ENVMEM_API_KEY)
  --url URL       Custom server URL (default: ${DEFAULT_URL})
  --help, -h      Show this help message

MCP Configuration (Claude Desktop):
  {
    "mcpServers": {
      "envmem": {
        "command": "npx",
        "args": ["envmem", "--api-key", "YOUR_API_KEY"]
      }
    }
  }

Available Tools:
  - search_env_variables: Natural language search for env vars
  - get_env_by_name: Get details for a specific variable
  - get_envs_for_services: Get all vars for multiple services
  - list_env_categories: Browse all categories
  - add_env_variable: Add a single variable
  - import_env_variables: Bulk import from .env format
  - delete_env_variable: Remove by name
  - clear_all_env_variables: Delete all (requires confirm=true)
`);
      process.exit(0);
    }
  }

  return config;
}

// Make HTTP request to the MCP server
async function mcpRequest(url, apiKey, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { 'x-api-key': apiKey }),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return response.json();
}

// Main stdio loop
async function main() {
  const config = parseArgs();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle JSON-RPC requests from stdin
  rl.on('line', async (line) => {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line);

      // Forward the request to the Cloudflare Worker
      const response = await mcpRequest(config.url, config.apiKey, request);

      // Send response to stdout
      console.log(JSON.stringify(response));
    } catch (error) {
      // Send error response
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: error.message || 'Internal error',
        },
      };
      console.log(JSON.stringify(errorResponse));
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Handle process signals
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
