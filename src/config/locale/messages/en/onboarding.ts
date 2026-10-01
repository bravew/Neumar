export default {
  // Step indicator
  stepOf: 'Step {current} of {total}',
  next: 'Next',
  back: 'Back',
  skip: 'Skip',
  getStarted: 'Get Started',

  // Step 1: Welcome & Profile
  welcomeTitle: 'Welcome to {appName}',
  welcomeSubtitle:
    "Let's personalize your experience — it only takes a minute.",
  enterName: 'Enter your name',
  uploadAvatar: 'Upload avatar',

  // Step 2: Appearance
  appearanceTitle: 'Choose Your Look',
  appearanceSubtitle: 'Pick a theme and style that feels right.',
  themeLabel: 'Theme',
  light: 'Light',
  dark: 'Dark',
  system: 'System',
  backgroundLabel: 'Background',
  bgDefault: 'Default',
  bgWarm: 'Warm',
  bgCool: 'Cool',
  languageLabel: 'Language',

  // Step 3: AI Provider
  providerTitle: 'Connect an AI Provider',
  providerSubtitle:
    'Add an API key to power your AI agent. You can always change this later in Settings.',
  providerOptionalNote:
    'This is optional — if you have a Claude subscription (Max/Team/Enterprise), the app works without an API key.',
  selectProvider: 'Choose a provider',
  apiKey: 'API Key',
  enterApiKey: 'Paste your API key here',
  getApiKey: 'Get API Key',
  providerConfigured: 'Configured',
  testConnection: 'Test Connection',
  testingConnection: 'Testing...',
  connectionSuccess: 'Connected successfully',
  connectionFailed: 'Connection failed',

  // Step 4: Local Models
  modelsTitle: 'Local Models',
  modelsSubtitle:
    'Download on-device models for offline speech and memory. These are optional and can be downloaded later.',
  sttModelLabel: 'Speech-to-Text (SenseVoice)',
  sttModelDescription: 'Transcribe voice input locally (~300 MB)',
  ttsModelLabel: 'Text-to-Speech (Kokoro)',
  ttsModelDescription: 'Read responses aloud locally (~180 MB)',
  embeddingModelLabel: 'Memory Embeddings',
  embeddingModelDescription:
    'Enable semantic memory for cross-session recall (~340 MB)',
  ollamaLabel: 'Ollama (Local LLM)',
  ollamaDescription:
    'Run open-source models locally with Ollama. No API key required.',
  ollamaUrl: 'Server URL',
  ollamaUrlPlaceholder: 'http://localhost:11434',
  ollamaConnected: 'Connected',
  ollamaDisconnected: 'Not running',
  ollamaTest: 'Test',
  ollamaTesting: 'Testing...',
  download: 'Download',
  downloading: 'Downloading...',
  downloaded: 'Ready',
  downloadFailed: 'Failed',
  retry: 'Retry',
  modelOptional: 'Optional',
  modelDownloadComplete: '{modelName} is ready',

  // Step 5: All Set
  readyTitle: "You're All Set!",
  readySubtitle:
    'Everything is configured. You can always adjust these settings later.',
  readySummaryProfile: 'Profile',
  readySummaryTheme: 'Theme',
  readySummaryProviders: 'AI Providers',
  readySummaryModels: 'Local Models',
  readyNoneConfigured: 'None configured',
  readyNoneDownloaded: 'None downloaded',
};
