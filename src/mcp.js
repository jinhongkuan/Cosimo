import express from 'express';
import { pool, queryOne, DEFAULT_DATA } from './db.js';
import { encryptData, decryptData, isEncrypted, verifyPassphrase } from './crypto.js';

export const mcpRouter = express.Router();

// Store active SSE connections
const sseConnections = new Map();

// Auth middleware that validates API key and optionally passphrase
async function mcpAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const passphrase = req.headers['x-passphrase'] || req.query.passphrase;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const user = await queryOne(
    'SELECT id, api_key, encryption_enabled, passphrase_hash FROM users WHERE api_key = $1',
    [apiKey]
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // If encryption enabled, require passphrase
  if (user.encryption_enabled) {
    if (!passphrase) {
      return res.status(401).json({
        error: 'Passphrase required. Add x-passphrase header to your MCP configuration.',
        code: 'PASSPHRASE_REQUIRED'
      });
    }

    if (!verifyPassphrase(passphrase, user.passphrase_hash)) {
      return res.status(401).json({
        error: 'Invalid passphrase',
        code: 'INVALID_PASSPHRASE'
      });
    }
  }

  req.userId = user.id;
  req.apiKey = user.api_key;
  req.passphrase = passphrase;
  req.encryptionEnabled = user.encryption_enabled;
  next();
}

// Helper to get user data
async function getUserData(userId, encryptionEnabled, passphrase) {
  const user = await queryOne('SELECT data FROM users WHERE id = $1', [userId]);
  if (!user || !user.data) return { ...DEFAULT_DATA };

  if (encryptionEnabled && isEncrypted(user.data)) {
    return decryptData(user.data, passphrase);
  }

  try {
    return JSON.parse(user.data);
  } catch {
    return { ...DEFAULT_DATA };
  }
}

// Helper to save user data
async function saveUserData(userId, encryptionEnabled, passphrase, data) {
  let dataToStore;
  if (encryptionEnabled) {
    dataToStore = encryptData(data, passphrase);
  } else {
    dataToStore = JSON.stringify(data);
  }
  await pool.query('UPDATE users SET data = $1, updated_at = NOW() WHERE id = $2', [dataToStore, userId]);
}

mcpRouter.get('/manifest', (req, res) => {
  res.json({
    name: 'cosimo',
    version: '1.0.0',
    description: 'Goal alignment system - bridge objectives ("what it does") and deliverables ("how it works")',
    instructions: `You are helping the user manage their goals in Cosimo, a system that bridges high-level objectives with concrete deliverables.

## Authentication

This MCP server requires an API key (x-api-key header).

If the user has enabled end-to-end encryption, you also need to provide:
- **Passphrase** (x-passphrase header) - decrypts the data

If encryption is not enabled, only the API key is needed.

## Core Concepts

**Objectives** = "What it does" — user-facing goals/outcomes
- Ranked by urgency (0-100): deadline proximity + impact
- Have optional \`deadline\` (ISO date) — items bubble up on dashboard as deadline approaches
- Examples: "Get healthy", "Launch MVP", "Build community"

**Deliverables** = "How it works" — concrete actions/tasks
- Ranked by feasibility (0-100): higher = easier (fewer blockers, lower complexity)
- Have optional time constraints:
  - \`available_after\`: Date when this becomes actionable (e.g., "after Jan 15" for post-trip tasks)
  - \`due_before\`: Hard deadline for this specific action
- Examples: "Schedule PCP appointment", "Build API", "Host first meetup"

**Relationships** = Semantic bridges explaining HOW a deliverable achieves an objective
- Key format: "obj-X:del-Y"
- Should explain the causal/logical connection, not just restate the titles

## When the user asks to add/update goals:

1. First call cosimo_get to see current state
2. Determine if it's an objective (outcome) or deliverable (action)
3. For deliverables, always link to a relevant objective
4. Write meaningful relationship descriptions that explain the "semantic bridge"
5. Set appropriate urgency/feasibility scores based on context
6. **Ask about timing**: If user mentions a goal/task, probe for time constraints:
   - "When do you need this done by?" → set deadline/due_before
   - "When can you start on this?" → set available_after
   - "Is this blocked by anything time-wise?" → helps set feasibility

## Scoring Guidelines

Urgency (objectives):
- 90-100: Due this week, critical impact
- 70-89: Due this month, high impact
- 50-69: Due this quarter, medium impact
- <50: Someday/nice-to-have

Feasibility (deliverables):
- 90-100: Can do today, no blockers
- 70-89: Can do this week, minor prep needed
- 50-69: Requires coordination or has dependencies
- <50: Blocked or highly complex

## Time-Aware Prioritization

The dashboard highlights items based on time pressure:
- Objectives with deadlines within 7 days get visual emphasis
- Deliverables only show as "actionable" after their available_after date
- Items past their due_before date are flagged as overdue

When a user mentions timing context (e.g., "I'm on a trip until Friday", "after I get back", "before my appointment on the 20th"), capture this in the appropriate date fields.`,
    tools: [
      {
        name: 'cosimo_get',
        description: 'Get all objectives and deliverables with their relationships',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'cosimo_set',
        description: 'Replace entire data (objectives, deliverables, relationships)',
        parameters: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              description: 'Full data object with objectives, deliverables, relationships arrays/objects'
            }
          },
          required: ['data']
        }
      },
      {
        name: 'cosimo_add_objective',
        description: 'Add a new objective (goal). Returns the new objective with generated ID.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            urgency: { type: 'number', minimum: 0, maximum: 100, description: 'Higher = more urgent' },
            deadline: { type: 'string', format: 'date' },
            impact: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
          },
          required: ['title']
        }
      },
      {
        name: 'cosimo_add_deliverable',
        description: 'Add a new deliverable (action) and link it to an objective',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            feasibility: { type: 'number', minimum: 0, maximum: 100, description: 'Higher = easier to do' },
            complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
            objectiveId: { type: 'string', description: 'ID of objective to link (e.g., obj-1)' },
            relationship: { type: 'string', description: 'Semantic bridge: how this action achieves the goal' },
            available_after: { type: 'string', format: 'date', description: 'Date when this becomes actionable (ISO format)' },
            due_before: { type: 'string', format: 'date', description: 'Hard deadline for this action (ISO format)' }
          },
          required: ['title', 'objectiveId']
        }
      },
      {
        name: 'cosimo_update_objective',
        description: 'Update an existing objective',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Objective ID (e.g., obj-1)' },
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
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Deliverable ID (e.g., del-1)' },
            title: { type: 'string' },
            description: { type: 'string' },
            feasibility: { type: 'number' },
            complexity: { type: 'string' },
            available_after: { type: 'string', format: 'date', description: 'Date when this becomes actionable' },
            due_before: { type: 'string', format: 'date', description: 'Hard deadline for this action' }
          },
          required: ['id']
        }
      },
      {
        name: 'cosimo_delete',
        description: 'Delete an objective or deliverable by ID',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ID to delete (e.g., obj-1 or del-2)' }
          },
          required: ['id']
        }
      }
    ]
  });
});

mcpRouter.post('/execute', mcpAuth, async (req, res) => {
  const { tool, parameters = {} } = req.body;

  try {
    let data = await getUserData(req.userId, req.encryptionEnabled, req.passphrase);

    switch (tool) {
      case 'cosimo_get':
        return res.json({ success: true, data });

      case 'cosimo_set':
        data = { ...parameters.data, lastUpdated: new Date().toISOString() };
        await saveUserData(req.userId, req.encryptionEnabled, req.passphrase, data);
        return res.json({ success: true, data });

      case 'cosimo_add_objective': {
        const maxId = data.objectives.length ? Math.max(...data.objectives.map(o => parseInt(o.id.split('-')[1]))) : 0;
        const newObj = {
          id: `obj-${maxId + 1}`,
          title: parameters.title,
          description: parameters.description || '',
          urgency: parameters.urgency ?? 50,
          deadline: parameters.deadline || '',
          impact: parameters.impact || 'medium',
          linkedDeliverables: []
        };
        data.objectives.push(newObj);
        data.lastUpdated = new Date().toISOString();
        await saveUserData(req.userId, req.encryptionEnabled, req.passphrase, data);
        return res.json({ success: true, created: newObj, data });
      }

      case 'cosimo_add_deliverable': {
        const maxId = data.deliverables.length ? Math.max(...data.deliverables.map(d => parseInt(d.id.split('-')[1]))) : 0;
        const newDel = {
          id: `del-${maxId + 1}`,
          title: parameters.title,
          description: parameters.description || '',
          feasibility: parameters.feasibility ?? 50,
          complexity: parameters.complexity || 'medium',
          blockers: [],
          linkedObjectives: [parameters.objectiveId],
          ...(parameters.available_after && { available_after: parameters.available_after }),
          ...(parameters.due_before && { due_before: parameters.due_before })
        };
        data.deliverables.push(newDel);

        const obj = data.objectives.find(o => o.id === parameters.objectiveId);
        if (obj) obj.linkedDeliverables.push(newDel.id);

        if (parameters.relationship) {
          data.relationships[`${parameters.objectiveId}:${newDel.id}`] = parameters.relationship;
        }
        data.lastUpdated = new Date().toISOString();
        await saveUserData(req.userId, req.encryptionEnabled, req.passphrase, data);
        return res.json({ success: true, created: newDel, data });
      }

      case 'cosimo_update_objective': {
        const obj = data.objectives.find(o => o.id === parameters.id);
        if (!obj) return res.status(404).json({ error: 'Objective not found' });
        Object.assign(obj, {
          ...(parameters.title && { title: parameters.title }),
          ...(parameters.description && { description: parameters.description }),
          ...(parameters.urgency !== undefined && { urgency: parameters.urgency }),
          ...(parameters.deadline && { deadline: parameters.deadline }),
          ...(parameters.impact && { impact: parameters.impact })
        });
        data.lastUpdated = new Date().toISOString();
        await saveUserData(req.userId, req.encryptionEnabled, req.passphrase, data);
        return res.json({ success: true, data });
      }

      case 'cosimo_update_deliverable': {
        const del = data.deliverables.find(d => d.id === parameters.id);
        if (!del) return res.status(404).json({ error: 'Deliverable not found' });
        Object.assign(del, {
          ...(parameters.title && { title: parameters.title }),
          ...(parameters.description && { description: parameters.description }),
          ...(parameters.feasibility !== undefined && { feasibility: parameters.feasibility }),
          ...(parameters.complexity && { complexity: parameters.complexity }),
          ...(parameters.available_after && { available_after: parameters.available_after }),
          ...(parameters.due_before && { due_before: parameters.due_before })
        });
        data.lastUpdated = new Date().toISOString();
        await saveUserData(req.userId, req.encryptionEnabled, req.passphrase, data);
        return res.json({ success: true, data });
      }

      case 'cosimo_delete': {
        const id = parameters.id;
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
        data.lastUpdated = new Date().toISOString();
        await saveUserData(req.userId, req.encryptionEnabled, req.passphrase, data);
        return res.json({ success: true, data });
      }

      default:
        return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }
  } catch (err) {
    console.error('MCP error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================
// MCP JSON-RPC Protocol (for Claude Code/Desktop)
// ===========================================

const MCP_TOOLS = [
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
        data: {
          type: 'object',
          description: 'Full data object with objectives, deliverables, relationships arrays/objects'
        }
      },
      required: ['data']
    }
  },
  {
    name: 'cosimo_add_objective',
    description: 'Add a new objective (goal). Returns the new objective with generated ID.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        urgency: { type: 'number', minimum: 0, maximum: 100, description: 'Higher = more urgent' },
        deadline: { type: 'string', format: 'date' },
        impact: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
      },
      required: ['title']
    }
  },
  {
    name: 'cosimo_add_deliverable',
    description: 'Add a new deliverable (action) and link it to an objective',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        feasibility: { type: 'number', minimum: 0, maximum: 100, description: 'Higher = easier to do' },
        complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
        objectiveId: { type: 'string', description: 'ID of objective to link (e.g., obj-1)' },
        relationship: { type: 'string', description: 'Semantic bridge: how this action achieves the goal' },
        available_after: { type: 'string', format: 'date', description: 'Date when this becomes actionable' },
        due_before: { type: 'string', format: 'date', description: 'Hard deadline for this action' }
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
        id: { type: 'string', description: 'Objective ID (e.g., obj-1)' },
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
        id: { type: 'string', description: 'Deliverable ID (e.g., del-1)' },
        title: { type: 'string' },
        description: { type: 'string' },
        feasibility: { type: 'number' },
        complexity: { type: 'string' },
        available_after: { type: 'string', format: 'date' },
        due_before: { type: 'string', format: 'date' }
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

const MCP_SERVER_INFO = {
  name: 'cosimo',
  version: '1.0.0',
  protocolVersion: '2024-11-05'
};

// Helper to execute a tool and return result
async function executeTool(toolName, args, userId, encryptionEnabled, passphrase) {
  let data = await getUserData(userId, encryptionEnabled, passphrase);

  switch (toolName) {
    case 'cosimo_get':
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };

    case 'cosimo_set':
      data = { ...args.data, lastUpdated: new Date().toISOString() };
      await saveUserData(userId, encryptionEnabled, passphrase, data);
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
      data.lastUpdated = new Date().toISOString();
      await saveUserData(userId, encryptionEnabled, passphrase, data);
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
      data.lastUpdated = new Date().toISOString();
      await saveUserData(userId, encryptionEnabled, passphrase, data);
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
      data.lastUpdated = new Date().toISOString();
      await saveUserData(userId, encryptionEnabled, passphrase, data);
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
      data.lastUpdated = new Date().toISOString();
      await saveUserData(userId, encryptionEnabled, passphrase, data);
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
      data.lastUpdated = new Date().toISOString();
      await saveUserData(userId, encryptionEnabled, passphrase, data);
      return { content: [{ type: 'text', text: `Deleted ${id}` }] };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Handle JSON-RPC request
async function handleJsonRpc(request, userId, encryptionEnabled, passphrase) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_SERVER_INFO.protocolVersion,
          serverInfo: { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
          capabilities: { tools: {} }
        }
      };

    case 'notifications/initialized':
      return null; // No response needed for notifications

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS }
      };

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await executeTool(name, args || {}, userId, encryptionEnabled, passphrase);
        return {
          jsonrpc: '2.0',
          id,
          result
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
          }
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      };
  }
}

// SSE endpoint for MCP - establishes connection and returns session ID
mcpRouter.get('/', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const passphrase = req.headers['x-passphrase'] || req.query.passphrase;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required. Add x-api-key header or ?api_key= query param.' });
  }

  const user = await queryOne(
    'SELECT id, api_key, encryption_enabled, passphrase_hash FROM users WHERE api_key = $1',
    [apiKey]
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (user.encryption_enabled) {
    if (!passphrase) {
      return res.status(401).json({ error: 'Passphrase required for encrypted account. Add x-passphrase header.' });
    }
    if (!verifyPassphrase(passphrase, user.passphrase_hash)) {
      return res.status(401).json({ error: 'Invalid passphrase' });
    }
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Generate session ID
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Store connection info
  sseConnections.set(sessionId, {
    res,
    userId: user.id,
    encryptionEnabled: user.encryption_enabled,
    passphrase
  });

  // Send endpoint event (tells client where to POST messages)
  const messagesUrl = `/mcp/messages?session_id=${sessionId}`;
  res.write(`event: endpoint\ndata: ${messagesUrl}\n\n`);

  // Keep-alive ping
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);

  // Cleanup on close
  req.on('close', () => {
    clearInterval(pingInterval);
    sseConnections.delete(sessionId);
  });
});

// POST endpoint for JSON-RPC messages
mcpRouter.post('/messages', async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId || !sseConnections.has(sessionId)) {
    return res.status(400).json({ error: 'Invalid or expired session. Reconnect to /mcp first.' });
  }

  const conn = sseConnections.get(sessionId);
  const { userId, encryptionEnabled, passphrase } = conn;

  try {
    const response = await handleJsonRpc(req.body, userId, encryptionEnabled, passphrase);

    if (response) {
      res.json(response);
    } else {
      res.status(202).send(); // Accepted (for notifications)
    }
  } catch (err) {
    console.error('MCP JSON-RPC error:', err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id,
      error: { code: -32603, message: err.message }
    });
  }
});
