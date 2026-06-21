import { CareerToolRegistry } from './tool-registry.js';

const registry = new CareerToolRegistry(
  process.env.CAREER_WORKER_URL || 'http://127.0.0.1:8791',
  process.env.NETWORK_MCP_BROWSER_WORKER_TOKEN || ''
);

console.log('network-career-mcp rc1');
console.log('Available tools:');
for (const tool of registry.listTools()) {
  console.log(`- ${tool}`);
}
console.log('This skeleton is ready to be wired into your existing MCP transport.');
