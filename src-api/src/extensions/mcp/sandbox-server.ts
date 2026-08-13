#!/usr/bin/env node
/**
 * Sandbox MCP Server
 *
 * Provides sandbox execution tools for the Claude Agent.
 * This allows the agent to run scripts in isolated containers
 * without needing to use curl commands.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DEFAULT_API_HOST, DEFAULT_API_PORT } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SandboxMCP');

// API port: 2620 for production, 5126 for development
// In dev mode (NODE_ENV=development), use 5126; otherwise use 2620
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const API_PORT =
  process.env.PORT || (isDev ? '5126' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

const server = new Server(
  {
    name: 'sandbox',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_script',
      description:
        'Run a script file in an isolated sandbox container. Automatically detects the runtime (Python, Node.js, Bun) based on file extension. The script file must already exist on disk.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute path to the script file to execute',
          },
          workDir: {
            type: 'string',
            description:
              'Working directory containing the script (use the directory where the script file is located)',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional command line arguments to pass to the script',
          },
          packages: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional packages to install before running (npm packages for Node.js/Bun)',
          },
          timeout: {
            type: 'number',
            description: 'Execution timeout in milliseconds (default: 120000)',
          },
        },
        required: ['filePath', 'workDir'],
      },
    },
    {
      name: 'run_command',
      description:
        'Execute a shell command in an isolated sandbox container. Use this for running commands that need specific dependencies or isolation.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            description:
              "The command to execute (e.g., 'python', 'node', 'npm')",
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments for the command',
          },
          workDir: {
            type: 'string',
            description:
              'Working directory for command execution (use absolute paths)',
          },
          image: {
            type: 'string',
            description:
              'Container image to use (default: auto-detected, options: node:18-alpine, python:3.11-slim, oven/bun:latest)',
          },
          timeout: {
            type: 'number',
            description: 'Execution timeout in milliseconds (default: 120000)',
          },
        },
        required: ['command', 'workDir'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'run_script') {
      const {
        filePath,
        workDir,
        args: scriptArgs,
        packages,
        timeout,
      } = args as {
        filePath: string;
        workDir: string;
        args?: string[];
        packages?: string[];
        timeout?: number;
      };

      const response = await fetch(`${SANDBOX_API_URL}/sandbox/run/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          workDir,
          args: scriptArgs,
          packages,
          timeout,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          content: [
            {
              type: 'text',
              text: `Sandbox API error (${response.status}): ${errorText}`,
            },
          ],
          isError: true,
        };
      }

      const result = await response.json();

      if (!result) {
        return {
          content: [
            { type: 'text', text: 'Sandbox API returned empty response' },
          ],
          isError: true,
        };
      }

      // Format the output nicely
      let output = '';
      if (result.success) {
        output = `✅ Script executed successfully (exit code: ${result.exitCode})\n`;
        output += `Runtime: ${result.runtime}\n`;
        output += `Duration: ${result.duration}ms\n`;
        output += `📁 Output files are saved to: ${workDir}\n\n`;
        if (result.stdout) {
          output += `--- stdout ---\n${result.stdout}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
      } else {
        output = `❌ Script execution failed (exit code: ${result.exitCode})\n`;
        if (result.error) {
          output += `Error: ${result.error}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
        if (result.stdout) {
          output += `--- stdout ---\n${result.stdout}\n`;
        }
      }

      return {
        content: [{ type: 'text', text: output }],
        isError: !result.success,
      };
    }

    if (name === 'run_command') {
      const {
        command,
        args: cmdArgs,
        workDir,
        image,
        timeout,
      } = args as {
        command: string;
        args?: string[];
        workDir: string;
        image?: string;
        timeout?: number;
      };

      const response = await fetch(`${SANDBOX_API_URL}/sandbox/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          args: cmdArgs,
          cwd: workDir,
          image,
          timeout,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          content: [
            {
              type: 'text',
              text: `Sandbox API error (${response.status}): ${errorText}`,
            },
          ],
          isError: true,
        };
      }

      const result = await response.json();

      if (!result) {
        return {
          content: [
            { type: 'text', text: 'Sandbox API returned empty response' },
          ],
          isError: true,
        };
      }

      let output = '';
      if (result.success) {
        output = `Command executed successfully (exit code: ${result.exitCode})\n`;
        output += `Duration: ${result.duration}ms\n\n`;
        if (result.stdout) {
          output += `--- stdout ---\n${result.stdout}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
      } else {
        output = `Command failed (exit code: ${result.exitCode})\n`;
        if (result.error) {
          output += `Error: ${result.error}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
      }

      return {
        content: [{ type: 'text', text: output }],
        isError: !result.success,
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Server started');
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
