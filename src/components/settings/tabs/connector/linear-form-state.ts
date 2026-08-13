export interface LinearFormState {
  apiKey: string;
  webhookSecret: string;
  teamId: string;
  assigneeFilter: string;
  pollIntervalMs: number;
  pollEnabled: boolean;
  webhookEnabled: boolean;
  autoProcess: boolean;
  workspaceDir: string;
  defaultBranch: string;
  githubToken: string;
  slackWebhookUrl: string;
  slackChannel: string;
}

export const defaultLinearFormState: LinearFormState = {
  apiKey: '',
  webhookSecret: '',
  teamId: '',
  assigneeFilter: '',
  pollIntervalMs: 300000,
  pollEnabled: false,
  webhookEnabled: true,
  autoProcess: false,
  workspaceDir: '',
  defaultBranch: 'main',
  githubToken: '',
  slackWebhookUrl: '',
  slackChannel: '',
};
