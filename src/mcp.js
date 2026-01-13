import express from 'express';
import { pool, queryOne } from './db.js';

export const mcpRouter = express.Router();

async function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const user = await queryOne('SELECT id FROM users WHERE api_key = $1', [apiKey]);
  if (!user) return res.status(401).json({ error: 'Invalid API key' });

  req.userId = user.id;
  next();
}

mcpRouter.get('/manifest', (req, res) => {
  res.json({
    name: 'cosimo',
    version: '1.0.0',
    description: 'Goal alignment system - bridge objectives ("what it does") and deliverables ("how it works")',
    instructions: `You are helping the user manage their goals in Cosimo, a system that bridges high-level objectives with concrete deliverables.

## Core Concepts

**Objectives** = "What it does" — user-facing goals/outcomes
- Ranked by urgency (0-100): deadline proximity + impact
- Examples: "Get healthy", "Launch MVP", "Build community"

**Deliverables** = "How it works" — concrete actions/tasks
- Ranked by feasibility (0-100): higher = easier (fewer blockers, lower complexity)
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
- <50: Blocked or highly complex`,
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
            relationship: { type: 'string', description: 'Semantic bridge: how this action achieves the goal' }
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
            complexity: { type: 'string' }
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

mcpRouter.post('/execute', apiKeyAuth, async (req, res) => {
  const { tool, parameters = {} } = req.body;
  const user = await queryOne('SELECT data FROM users WHERE id = $1', [req.userId]);
  let data = user.data;

  try {
    switch (tool) {
      case 'cosimo_get':
        return res.json({ success: true, data });

      case 'cosimo_set':
        data = { ...parameters.data, lastUpdated: new Date().toISOString() };
        break;

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
          linkedObjectives: [parameters.objectiveId]
        };
        data.deliverables.push(newDel);

        const obj = data.objectives.find(o => o.id === parameters.objectiveId);
        if (obj) obj.linkedDeliverables.push(newDel.id);

        if (parameters.relationship) {
          data.relationships[`${parameters.objectiveId}:${newDel.id}`] = parameters.relationship;
        }
        data.lastUpdated = new Date().toISOString();

        await pool.query('UPDATE users SET data = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(data), req.userId]);
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
        break;
      }

      case 'cosimo_update_deliverable': {
        const del = data.deliverables.find(d => d.id === parameters.id);
        if (!del) return res.status(404).json({ error: 'Deliverable not found' });
        Object.assign(del, {
          ...(parameters.title && { title: parameters.title }),
          ...(parameters.description && { description: parameters.description }),
          ...(parameters.feasibility !== undefined && { feasibility: parameters.feasibility }),
          ...(parameters.complexity && { complexity: parameters.complexity })
        });
        data.lastUpdated = new Date().toISOString();
        break;
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
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }

    await pool.query('UPDATE users SET data = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(data), req.userId]);
    res.json({ success: true, data });
  } catch (err) {
    console.error('MCP error:', err);
    res.status(500).json({ error: err.message });
  }
});
