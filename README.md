# Cosimo

A goal alignment system that bridges the semantic gap between what you want to achieve and how to get there.

## The Problem: Semantic Gap

When we set goals, there's often a disconnect between:

- **Objectives** — _"What it does"_ — The outcomes we want (e.g., "Get healthy")
- **Deliverables** — _"How it works"_ — The concrete actions (e.g., "Schedule a doctor appointment")

This gap is the **semantic bridge**: the causal reasoning that explains _why_ a specific action achieves a broader goal. Traditional task managers track what you need to do, but not _why_ — losing the context that makes prioritization meaningful.

Cosimo makes this bridge explicit. When an AI assistant helps you plan, it doesn't just add tasks — it captures the relationship between actions and outcomes and helps to identify high-leverage tasks that make your life better.

## How It Works

```
┌────────────────┐                           ┌────────────────┐
│  Claude Code   │ ──stdio──► cosimo-mcp ───►│     Cosimo     │
│  or Desktop    │           (local, E2E)    │     Server     │
└────────────────┘                           └───────┬────────┘
        │                                            │
        │  Encryption/decryption                     │  Stores encrypted
        │  happens here (your machine)               │  blobs only
        │                                            │
        └────────────────────────────────────────────┴──► Dashboard
```

Your AI assistant syncs goals to Cosimo via a local MCP server. The local server handles encryption — your passphrase never leaves your machine.

## Security: True End-to-End Encryption

**What it does**: Your data is encrypted before it leaves your device.

**How it works**: The `cosimo-mcp` package runs locally on your machine. It encrypts your data with AES-256-GCM using your passphrase before sending anything to the server. The server only ever sees encrypted blobs — even server administrators cannot read your data.

- Passphrase stays on your machine (in environment variable)
- Encryption/decryption happens locally
- Server stores opaque encrypted strings
- Dashboard decrypts in your browser

## Setup

### 1. Create an Account

Go to [cosimo.bicameral-ai.com](https://cosimo.bicameral-ai.com) and sign in with Google. Copy your API key (`csk_...`) from the dashboard.

### 2. Configure Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "cosimo": {
      "command": "npx",
      "args": ["-y", "@bicameral/cosimo-mcp"],
      "env": {
        "COSIMO_API_KEY": "csk_your_api_key_here",
        "COSIMO_PASSPHRASE": "your_encryption_passphrase"
      }
    }
  }
}
```

That's it. The MCP server runs locally, handles encryption, and syncs with Cosimo.

### 3. Start Using

Ask Claude to help with your goals. Changes sync to your dashboard in real-time.

## Usage

Once configured, Claude can help manage your goals naturally:

> "I want to get healthier this year"

Claude will create an objective and help you break it down into deliverables, capturing the semantic bridge for each:

- **Objective**: "Improve physical health" (urgency: 70, deadline: 2025-12-31)
  - **Deliverable**: "Schedule annual physical" (feasibility: 90)
    - _Bridge_: "Establishes baseline health metrics and identifies issues early"
  - **Deliverable**: "Set up home gym" (feasibility: 60, available_after: 2025-02-01)
    - _Bridge_: "Removes friction from exercise by eliminating commute to gym"

### Time-Aware Prioritization

Cosimo understands timing constraints:

> "I need to file taxes before April 15, but I can't start until I get my W-2s in late January"

This creates a deliverable with `available_after: 2025-01-25` and `due_before: 2025-04-15`. The dashboard highlights approaching deadlines and actionable items.

## Development

```bash
# Server
npm install
npm run dev

# Local MCP package
cd packages/cosimo-mcp
npm install
```

## License

MIT License — Free to use, modify, and distribute.

Created by [Bicameral](https://github.com/jinhongkuan)
