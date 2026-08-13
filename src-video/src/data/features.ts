export const features = [
  {
    featureId: 'agent-chat',
    title: 'Natural Language Agent',
    description: 'Execute complex tasks through conversation',
    screenshot: 'task-detail-streaming.png',
    highlights: [
      { text: 'Streaming responses', x: 20, y: 30 },
      { text: 'Tool usage visible', x: 60, y: 50 },
      { text: 'Artifact preview', x: 75, y: 70 },
    ],
  },
  {
    featureId: 'mcp-tools',
    title: 'MCP Tool Ecosystem',
    description: 'Connect any tool via Model Context Protocol',
    screenshot: 'task-detail-artifacts.png',
    highlights: [
      { text: 'File operations', x: 15, y: 40 },
      { text: 'Web browsing', x: 45, y: 55 },
      { text: 'Code execution', x: 70, y: 40 },
    ],
  },
  {
    featureId: 'multi-provider',
    title: 'Multi-Provider AI',
    description: 'Claude, GPT, Gemini, DeepSeek \u2014 your choice',
    screenshot: 'setup.png',
    highlights: [
      { text: 'Switch models freely', x: 30, y: 45 },
      { text: 'Compare outputs', x: 65, y: 45 },
    ],
  },
  {
    featureId: 'automation',
    title: 'Automation & Scheduling',
    description: 'Set it and forget it \u2014 cron, webhooks, heartbeat',
    screenshot: 'automation.png',
    highlights: [
      { text: 'Cron schedules', x: 25, y: 35 },
      { text: 'Webhook triggers', x: 55, y: 55 },
      { text: 'Multi-channel delivery', x: 40, y: 75 },
    ],
  },
  {
    featureId: 'workspaces',
    title: 'Project Workspaces',
    description: 'Organize tasks by project with dedicated context',
    screenshot: 'dashboard.png',
    highlights: [
      { text: 'Project isolation', x: 20, y: 40 },
      { text: 'Shared knowledge', x: 60, y: 60 },
    ],
  },
] as const;
