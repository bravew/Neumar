export default {
  // Step indicator
  stepOf: 'Étape {current} sur {total}',
  next: 'Suivant',
  back: 'Retour',
  skip: 'Passer',
  getStarted: 'Commencer',

  // Step 1: Welcome & Profile
  welcomeTitle: 'Bienvenue sur {appName}',
  welcomeSubtitle:
    "Personnalisons votre expérience — cela ne prend qu'une minute.",
  enterName: 'Entrez votre nom',
  uploadAvatar: 'Télécharger un avatar',

  // Step 2: Appearance
  appearanceTitle: 'Choisissez Votre Style',
  appearanceSubtitle: 'Sélectionnez un thème et un style qui vous conviennent.',
  themeLabel: 'Thème',
  light: 'Clair',
  dark: 'Sombre',
  system: 'Système',
  backgroundLabel: 'Arrière-plan',
  bgDefault: 'Par défaut',
  bgWarm: 'Chaud',
  bgCool: 'Froid',
  languageLabel: 'Langue',

  // Step 3: AI Provider
  providerTitle: 'Connecter un Fournisseur IA',
  providerSubtitle:
    'Ajoutez une clé API pour alimenter votre agent IA. Vous pourrez la modifier plus tard dans les Paramètres.',
  providerOptionalNote:
    "C'est optionnel — si vous avez un abonnement Claude (Max/Team/Enterprise), l'app fonctionne sans clé API.",
  selectProvider: 'Choisir un fournisseur',
  apiKey: 'Clé API',
  enterApiKey: 'Collez votre clé API ici',
  getApiKey: 'Obtenir une Clé API',
  providerConfigured: 'Configuré',
  testConnection: 'Tester la Connexion',
  testingConnection: 'Test en cours...',
  connectionSuccess: 'Connexion réussie',
  connectionFailed: 'Échec de la connexion',

  // Step 4: Local Models
  modelsTitle: 'Modèles Locaux',
  modelsSubtitle:
    'Téléchargez des modèles locaux pour la voix et la mémoire hors ligne. Ils sont optionnels et peuvent être téléchargés plus tard.',
  sttModelLabel: 'Voix vers Texte (SenseVoice)',
  sttModelDescription: 'Transcription vocale locale (~300 Mo)',
  ttsModelLabel: 'Texte vers Voix (Kokoro)',
  ttsModelDescription: 'Lecture vocale des réponses (~180 Mo)',
  embeddingModelLabel: 'Embeddings de Mémoire',
  embeddingModelDescription:
    'Active la mémoire sémantique entre les sessions (~340 Mo)',
  ollamaLabel: 'Ollama (LLM Local)',
  ollamaDescription:
    'Exécutez des modèles open source localement avec Ollama. Aucune clé API requise.',
  ollamaUrl: 'URL du serveur',
  ollamaUrlPlaceholder: 'http://localhost:11434',
  ollamaConnected: 'Connecté',
  ollamaDisconnected: "N'est pas en cours d'exécution",
  ollamaTest: 'Tester',
  ollamaTesting: 'Test en cours...',
  download: 'Télécharger',
  downloading: 'Téléchargement...',
  downloaded: 'Prêt',
  downloadFailed: 'Échec',
  retry: 'Réessayer',
  modelOptional: 'Optionnel',
  modelDownloadComplete: '{modelName} est prêt',

  // Step 5: All Set
  readyTitle: 'Tout est Prêt !',
  readySubtitle:
    'Tout est configuré. Vous pouvez ajuster ces paramètres à tout moment.',
  readySummaryProfile: 'Profil',
  readySummaryTheme: 'Thème',
  readySummaryProviders: 'Fournisseurs IA',
  readySummaryModels: 'Modèles Locaux',
  readyNoneConfigured: 'Non configuré',
  readyNoneDownloaded: 'Non téléchargé',
};
