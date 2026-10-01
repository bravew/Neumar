export default {
  // Step indicator
  stepOf: 'Passo {current} de {total}',
  next: 'Próximo',
  back: 'Voltar',
  skip: 'Pular',
  getStarted: 'Começar',

  // Step 1: Welcome & Profile
  welcomeTitle: 'Bem-vindo ao {appName}',
  welcomeSubtitle:
    'Vamos personalizar sua experiência — leva apenas um minuto.',
  enterName: 'Digite seu nome',
  uploadAvatar: 'Enviar avatar',

  // Step 2: Appearance
  appearanceTitle: 'Escolha Seu Visual',
  appearanceSubtitle: 'Escolha um tema e estilo que combinem com você.',
  themeLabel: 'Tema',
  light: 'Claro',
  dark: 'Escuro',
  system: 'Sistema',
  backgroundLabel: 'Fundo',
  bgDefault: 'Padrão',
  bgWarm: 'Quente',
  bgCool: 'Frio',
  languageLabel: 'Idioma',

  // Step 3: AI Provider
  providerTitle: 'Conectar um Provedor de IA',
  providerSubtitle:
    'Adicione uma chave de API para alimentar seu agente de IA. Você pode alterar isso depois nas Configurações.',
  providerOptionalNote:
    'Isso é opcional — se você tem uma assinatura Claude (Max/Team/Enterprise), o app funciona sem chave de API.',
  selectProvider: 'Escolha um provedor',
  apiKey: 'Chave de API',
  enterApiKey: 'Cole sua chave de API aqui',
  getApiKey: 'Obter Chave de API',
  providerConfigured: 'Configurado',
  testConnection: 'Testar Conexão',
  testingConnection: 'Testando...',
  connectionSuccess: 'Conectado com sucesso',
  connectionFailed: 'Conexão falhou',

  // Step 4: Local Models
  modelsTitle: 'Modelos Locais',
  modelsSubtitle:
    'Baixe modelos no dispositivo para fala e memória offline. São opcionais e podem ser baixados depois.',
  sttModelLabel: 'Fala para Texto (SenseVoice)',
  sttModelDescription: 'Transcreva entrada de voz localmente (~300 MB)',
  ttsModelLabel: 'Texto para Fala (Kokoro)',
  ttsModelDescription: 'Leia respostas em voz alta localmente (~180 MB)',
  embeddingModelLabel: 'Embeddings de Memória',
  embeddingModelDescription:
    'Habilitar memória semântica para recuperação entre sessões (~340 MB)',
  ollamaLabel: 'Ollama (LLM Local)',
  ollamaDescription:
    'Execute modelos de código aberto localmente com Ollama. Sem necessidade de chave de API.',
  ollamaUrl: 'URL do Servidor',
  ollamaUrlPlaceholder: 'http://localhost:11434',
  ollamaConnected: 'Conectado',
  ollamaDisconnected: 'Não está rodando',
  ollamaTest: 'Testar',
  ollamaTesting: 'Testando...',
  download: 'Baixar',
  downloading: 'Baixando...',
  downloaded: 'Pronto',
  downloadFailed: 'Falhou',
  retry: 'Tentar novamente',
  modelOptional: 'Opcional',
  modelDownloadComplete: '{modelName} pronto',

  // Step 5: All Set
  readyTitle: 'Tudo Pronto!',
  readySubtitle:
    'Tudo está configurado. Você pode ajustar essas configurações depois a qualquer momento.',
  readySummaryProfile: 'Perfil',
  readySummaryTheme: 'Tema',
  readySummaryProviders: 'Provedores de IA',
  readySummaryModels: 'Modelos Locais',
  readyNoneConfigured: 'Nenhum configurado',
  readyNoneDownloaded: 'Nenhum baixado',
};
