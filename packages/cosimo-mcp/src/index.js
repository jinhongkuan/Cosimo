#!/usr/bin/env node

import { createInterface } from 'readline';
import { encryptData, decryptData, isEncrypted } from './crypto.js';

const SERVER_URL = process.env.COSIMO_URL || 'https://cosimo.bicameral-ai.com';
const API_KEY = process.env.COSIMO_API_KEY;
const PASSPHRASE = process.env.COSIMO_PASSPHRASE;

const SERVER_INFO = {
  name: 'cosimo',
  version: '1.0.0',
  protocolVersion: '2024-11-05'
};

const TOOLS = [
  {
    name: 'cosimo_get',
    description: 'Get all objectives and deliverables with their relationships',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cosimo_set',
    description: 'Replace entire data (objectives, deliverables, relationships)',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'Full data object' }
      },
      required: ['data']
    }
  },
  {
    name: 'cosimo_add_objective',
    description: 'Add a new objective (goal)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        urgency: { type: 'number', minimum: 0, maximum: 100 },
        deadline: { type: 'string', format: 'date' },
        impact: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
      },
      required: ['title']
    }
  },
  {
    name: 'cosimo_add_deliverable',
    description: 'Add a new deliverable (action) linked to an objective',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        feasibility: { type: 'number', minimum: 0, maximum: 100 },
        complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
        objectiveId: { type: 'string', description: 'ID of objective to link (e.g., obj-1)' },
        relationship: { type: 'string', description: 'How this action achieves the goal' },
        available_after: { type: 'string', format: 'date' },
        due_before: { type: 'string', format: 'date' }
      },
      required: ['title', 'objectiveId']
    }
  },
  {
    name: 'cosimo_update_objective',
    description: 'Update an existing objective',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        urgency: { type: 'number' },
        deadline: { type: 'string' },
        impact: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'cosimo_update_deliverable',
    description: 'Update an existing deliverable',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        feasibility: { type: 'number' },
        complexity: { type: 'string' },
        available_after: { type: 'string' },
        due_before: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'cosimo_delete',
    description: 'Delete an objective or deliverable by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID to delete (e.g., obj-1 or del-2)' }
      },
      required: ['id']
    }
  }
];

const DEFAULT_DATA = {
  objectives: [],
  deliverables: [],
  relationships: {},
  lastUpdated: null
};

// Fetch data from server and decrypt locally
async function fetchData() {
  const res = await fetch(`${SERVER_URL}/api/blob`, {
    headers: { 'x-api-key': API_KEY }
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const { data: encrypted } = await res.json();

  if (!encrypted) return { ...DEFAULT_DATA };
  if (PASSPHRASE && isEncrypted(encrypted)) {
    return decryptData(encrypted, PASSPHRASE);
  }
  try {
    return JSON.parse(encrypted);
  } catch {
    return { ...DEFAULT_DATA };
  }
}

// Encrypt locally and save to server
async function saveData(data) {
  data.lastUpdated = new Date().toISOString();
  const encrypted = PASSPHRASE ? encryptData(data, PASSPHRASE) : JSON.stringify(data);

  const res = await fetch(`${SERVER_URL}/api/blob`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({ data: encrypted })
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return data;
}

// Execute tool with local encryption
async function executeTool(name, args) {
  let data = await fetchData();

  switch (name) {
    case 'cosimo_get':
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };

    case 'cosimo_set':
      data = await saveData({ ...args.data, lastUpdated: new Date().toISOString() });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };

    case 'cosimo_add_objective': {
      const maxId = data.objectives.length ? Math.max(...data.objectives.map(o => parseInt(o.id.split('-')[1]))) : 0;
      const newObj = {
        id: `obj-${maxId + 1}`,
        title: args.title,
        description: args.description || '',
        urgency: args.urgency ?? 50,
        deadline: args.deadline || '',
        impact: args.impact || 'medium',
        linkedDeliverables: []
      };
      data.objectives.push(newObj);
      await saveData(data);
      return { content: [{ type: 'text', text: `Created objective: ${JSON.stringify(newObj, null, 2)}` }] };
    }

    case 'cosimo_add_deliverable': {
      const maxId = data.deliverables.length ? Math.max(...data.deliverables.map(d => parseInt(d.id.split('-')[1]))) : 0;
      const newDel = {
        id: `del-${maxId + 1}`,
        title: args.title,
        description: args.description || '',
        feasibility: args.feasibility ?? 50,
        complexity: args.complexity || 'medium',
        blockers: [],
        linkedObjectives: [args.objectiveId],
        ...(args.available_after && { available_after: args.available_after }),
        ...(args.due_before && { due_before: args.due_before })
      };
      data.deliverables.push(newDel);

      const obj = data.objectives.find(o => o.id === args.objectiveId);
      if (obj) obj.linkedDeliverables.push(newDel.id);

      if (args.relationship) {
        data.relationships[`${args.objectiveId}:${newDel.id}`] = args.relationship;
      }
      await saveData(data);
      return { content: [{ type: 'text', text: `Created deliverable: ${JSON.stringify(newDel, null, 2)}` }] };
    }

    case 'cosimo_update_objective': {
      const obj = data.objectives.find(o => o.id === args.id);
      if (!obj) throw new Error('Objective not found');
      Object.assign(obj, {
        ...(args.title && { title: args.title }),
        ...(args.description && { description: args.description }),
        ...(args.urgency !== undefined && { urgency: args.urgency }),
        ...(args.deadline && { deadline: args.deadline }),
        ...(args.impact && { impact: args.impact })
      });
      await saveData(data);
      return { content: [{ type: 'text', text: `Updated objective: ${JSON.stringify(obj, null, 2)}` }] };
    }

    case 'cosimo_update_deliverable': {
      const del = data.deliverables.find(d => d.id === args.id);
      if (!del) throw new Error('Deliverable not found');
      Object.assign(del, {
        ...(args.title && { title: args.title }),
        ...(args.description && { description: args.description }),
        ...(args.feasibility !== undefined && { feasibility: args.feasibility }),
        ...(args.complexity && { complexity: args.complexity }),
        ...(args.available_after && { available_after: args.available_after }),
        ...(args.due_before && { due_before: args.due_before })
      });
      await saveData(data);
      return { content: [{ type: 'text', text: `Updated deliverable: ${JSON.stringify(del, null, 2)}` }] };
    }

    case 'cosimo_delete': {
      const id = args.id;
      if (id.startsWith('obj-')) {
        data.objectives = data.objectives.filter(o => o.id !== id);
        data.deliverables.forEach(d => {
          d.linkedObjectives = d.linkedObjectives.filter(oid => oid !== id);
        });
        Object.keys(data.relationships).forEach(k => {
          if (k.startsWith(`${id}:`)) delete data.relationships[k];
        });
      } else if (id.startsWith('del-')) {
        data.deliverables = data.deliverables.filter(d => d.id !== id);
        data.objectives.forEach(o => {
          o.linkedDeliverables = o.linkedDeliverables.filter(did => did !== id);
        });
        Object.keys(data.relationships).forEach(k => {
          if (k.endsWith(`:${id}`)) delete data.relationships[k];
        });
      }
      await saveData(data);
      return { content: [{ type: 'text', text: `Deleted ${id}` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Handle JSON-RPC request
async function handleRequest(request) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SERVER_INFO.protocolVersion,
          serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
          capabilities: { tools: {} }
        }
      };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await executeTool(name, args || {});
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
        };
      }
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

// Stdio transport
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' }
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
});

// Validate config on startup
if (!API_KEY) {
  console.error('Error: COSIMO_API_KEY environment variable required');
  process.exit(1);
}
