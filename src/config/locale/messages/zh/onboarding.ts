export default {
  // Step indicator
  stepOf: '第 {current} 步，共 {total} 步',
  next: '下一步',
  back: '上一步',
  skip: '跳过',
  getStarted: '开始使用',

  // Step 1: Welcome & Profile
  welcomeTitle: '欢迎使用 {appName}',
  welcomeSubtitle: '让我们个性化你的体验——只需一分钟。',
  enterName: '输入你的名字',
  uploadAvatar: '上传头像',

  // Step 2: Appearance
  appearanceTitle: '选择你的外观',
  appearanceSubtitle: '选择适合你的主题和风格。',
  themeLabel: '主题',
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
  backgroundLabel: '背景',
  bgDefault: '默认',
  bgWarm: '暖色',
  bgCool: '冷色',
  languageLabel: '语言',

  // Step 3: AI Provider
  providerTitle: '连接 AI 服务商',
  providerSubtitle: '添加 API 密钥来驱动你的 AI 代理。你随时可以在设置中更改。',
  providerOptionalNote:
    '此步骤为可选——如果你有 Claude 订阅（Max/Team/Enterprise），无需 API 密钥即可使用。',
  selectProvider: '选择服务商',
  apiKey: 'API 密钥',
  enterApiKey: '在此粘贴你的 API 密钥',
  getApiKey: '获取 API 密钥',
  providerConfigured: '已配置',
  testConnection: '测试连接',
  testingConnection: '正在测试...',
  connectionSuccess: '连接成功',
  connectionFailed: '连接失败',

  // Step 4: Local Models
  modelsTitle: '本地模型',
  modelsSubtitle:
    '下载离线语音和记忆的本地模型。这些是可选的，也可以稍后下载。',
  sttModelLabel: '语音转文字 (SenseVoice)',
  sttModelDescription: '本地转录语音输入（约 300 MB）',
  ttsModelLabel: '文字转语音 (Kokoro)',
  ttsModelDescription: '本地朗读回复（约 180 MB）',
  embeddingModelLabel: '记忆嵌入模型',
  embeddingModelDescription: '启用跨会话的语义记忆（约 340 MB）',
  ollamaLabel: 'Ollama（本地大模型）',
  ollamaDescription: '使用 Ollama 在本地运行开源模型，无需 API 密钥。',
  ollamaUrl: '服务器地址',
  ollamaUrlPlaceholder: 'http://localhost:11434',
  ollamaConnected: '已连接',
  ollamaDisconnected: '未运行',
  ollamaTest: '测试',
  ollamaTesting: '测试中...',
  download: '下载',
  downloading: '下载中...',
  downloaded: '就绪',
  downloadFailed: '失败',
  retry: '重试',
  modelOptional: '可选',
  modelDownloadComplete: '{modelName} 已准备就绪',

  // Step 5: All Set
  readyTitle: '一切就绪！',
  readySubtitle: '所有配置已完成。你随时可以在设置中调整。',
  readySummaryProfile: '个人资料',
  readySummaryTheme: '主题',
  readySummaryProviders: 'AI 服务商',
  readySummaryModels: '本地模型',
  readyNoneConfigured: '未配置',
  readyNoneDownloaded: '未下载',
};
