export default {
  // Step indicator
  stepOf: 'Paso {current} de {total}',
  next: 'Siguiente',
  back: 'Atrás',
  skip: 'Omitir',
  getStarted: 'Comenzar',

  // Step 1: Welcome & Profile
  welcomeTitle: 'Bienvenido a {appName}',
  welcomeSubtitle: 'Personalicemos tu experiencia — solo toma un minuto.',
  enterName: 'Ingresa tu nombre',
  uploadAvatar: 'Subir avatar',

  // Step 2: Appearance
  appearanceTitle: 'Elige tu Estilo',
  appearanceSubtitle: 'Selecciona un tema y estilo que te guste.',
  themeLabel: 'Tema',
  light: 'Claro',
  dark: 'Oscuro',
  system: 'Sistema',
  backgroundLabel: 'Fondo',
  bgDefault: 'Predeterminado',
  bgWarm: 'Cálido',
  bgCool: 'Frío',
  languageLabel: 'Idioma',

  // Step 3: AI Provider
  providerTitle: 'Conecta un Proveedor de IA',
  providerSubtitle:
    'Agrega una clave API para potenciar tu agente de IA. Puedes cambiarlo después en Configuración.',
  providerOptionalNote:
    'Esto es opcional — si tienes una suscripción a Claude (Max/Team/Enterprise), la app funciona sin clave API.',
  selectProvider: 'Elige un proveedor',
  apiKey: 'Clave API',
  enterApiKey: 'Pega tu clave API aquí',
  getApiKey: 'Obtener Clave API',
  providerConfigured: 'Configurado',
  testConnection: 'Probar Conexión',
  testingConnection: 'Probando...',
  connectionSuccess: 'Conexión exitosa',
  connectionFailed: 'Conexión fallida',

  // Step 4: Local Models
  modelsTitle: 'Modelos Locales',
  modelsSubtitle:
    'Descarga modelos en el dispositivo para voz y memoria sin conexión. Son opcionales y se pueden descargar después.',
  sttModelLabel: 'Voz a Texto (SenseVoice)',
  sttModelDescription: 'Transcribe entrada de voz localmente (~300 MB)',
  ttsModelLabel: 'Texto a Voz (Kokoro)',
  ttsModelDescription: 'Lee respuestas en voz alta localmente (~180 MB)',
  embeddingModelLabel: 'Embeddings de Memoria',
  embeddingModelDescription:
    'Habilita memoria semántica entre sesiones (~340 MB)',
  ollamaLabel: 'Ollama (LLM Local)',
  ollamaDescription:
    'Ejecuta modelos de código abierto localmente con Ollama. No requiere clave API.',
  ollamaUrl: 'URL del servidor',
  ollamaUrlPlaceholder: 'http://localhost:11434',
  ollamaConnected: 'Conectado',
  ollamaDisconnected: 'No está ejecutándose',
  ollamaTest: 'Probar',
  ollamaTesting: 'Probando...',
  download: 'Descargar',
  downloading: 'Descargando...',
  downloaded: 'Listo',
  downloadFailed: 'Falló',
  retry: 'Reintentar',
  modelOptional: 'Opcional',
  modelDownloadComplete: '{modelName} listo',

  // Step 5: All Set
  readyTitle: '¡Todo Listo!',
  readySubtitle:
    'Todo está configurado. Siempre puedes ajustar estos ajustes después.',
  readySummaryProfile: 'Perfil',
  readySummaryTheme: 'Tema',
  readySummaryProviders: 'Proveedores de IA',
  readySummaryModels: 'Modelos Locales',
  readyNoneConfigured: 'No configurado',
  readyNoneDownloaded: 'No descargado',
};
