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
┌────────────────┐         MCP          ┌────────────────┐
│  Claude Code   │ ───────────────────► │     Cosimo     │
│  or Desktop    │   (API Key Auth)     │     Server     │
└────────────────┘                      └───────┬────────┘
                                                │
                                                ▼
                                        ┌────────────────┐
                                        │   Dashboard    │
                                        │  (Real-time)   │
                                        └────────────────┘
```

Your AI assistant syncs goals to Cosimo via MCP. View them anytime on the dashboard.

## Setup

### 1. Create an Account

Go to [cosimo.bicameral-ai.com](https://cosimo.bicameral-ai.com) and register. Copy your API key (`csk_...`) from the dashboard.

### 2. Configure Your Agent

#### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cosimo": {
      "type": "http",
      "url": "https://cosimo.bicameral-ai.com/mcp",
      "headers": {
        "x-api-key": "csk_your_api_key_here"
      }
    }
  }
}
```

#### Claude Desktop

1. Open Claude Desktop settings and go to **Extensions**
2. Search for "Cosimo" and install
3. Enter your API key when prompted

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

Cosimo understands timing constraints. When you mention deadlines or availability, Claude will capture them:

> "I need to file taxes before April 15, but I can't start until I get my W-2s in late January"

This creates a deliverable with `available_after: 2025-01-25` and `due_before: 2025-04-15`. The dashboard highlights:
- **Approaching deadlines**: Objectives/deliverables due within 7 days get visual emphasis
- **Actionable items**: Deliverables only appear as "ready" after their `available_after` date
- **Overdue items**: Anything past its deadline is flagged

View your goals on the dashboard with real-time updates as Claude modifies them.

## License

MIT License — Free to use, modify, and distribute. See [LICENSE](LICENSE) for details.

Attribution appreciated: **Created by [jinhongkuan](https://github.com/jinhongkuan)**
