export default {
  title: "Profils d'agents",
  createProfile: 'Créer un profil',
  editProfile: 'Modifier le profil',
  deleteProfile: 'Supprimer le profil',
  name: 'Nom',
  role: 'Rôle',
  description: 'Description',
  runtime: "Environnement d'exécution",
  model: 'Modèle',
  status: 'Statut',
  active: 'Actif',
  paused: 'En pause',
  archived: 'Archivé',
  systemPrompt: 'Prompt système',
  noProfiles: 'Aucun profil pour le moment',
  confirmDelete: 'Êtes-vous sûr de vouloir supprimer ce profil ?',
  cannotDeleteRunning:
    'Impossible de supprimer un profil avec des tâches en cours',
  selectRuntime: "Sélectionner l'environnement...",
  mcpServers: 'Serveurs MCP',
  skills: 'Compétences',
  maxConcurrentTasks: 'Tâches simultanées max.',
  taskCount: '{count} tâches',
  noTasks: 'Aucune tâche',
  assignedAgent: 'Agent assigné',
  noAgent: 'Aucun agent',
  unavailable: '(indisponible)',
  all: 'Tous',
  newAgent: 'Nouvel agent',
  newTask: 'Nouvelle tâche',
  noProfilesForFilter: 'Aucun agent ne correspond à ce filtre.',
  advanced: 'Avancé',
  // Soul Editor
  soulEditor: "Éditeur d'âme",
  editSoul: "Modifier l'âme",
  chooseSoulTemplate: 'Choisir un modèle',
  soulVersion: 'Âme v{version}',
  soulManagedPrompt: "Prompt système géré par l'Éditeur d'âme",

  // Soul Tabs
  soulIdentity: 'Identité',
  soulVoice: 'Voix',
  soulCognition: 'Cognition',
  soulBoundaries: 'Limites',
  soulEvolution: 'Évolution',

  // Identity
  soulRole: 'Rôle',
  soulRoleDesc: "Le rôle ou persona principal qu'incarne cet agent.",
  soulCoreValues: 'Valeurs fondamentales',
  soulCoreValuesDesc:
    'Principes directeurs qui façonnent le comportement et la prise de décision.',
  soulCoreValuesPlaceholder: 'Ajouter une valeur fondamentale...',
  soulWorldview: 'Vision du monde',
  soulWorldviewPlaceholder: 'Décrivez comment cet agent perçoit le monde...',
  soulOpinions: 'Opinions',
  soulOpinionsDesc: "Positions ou convictions fortes que l'agent défend.",
  soulOpinionsPlaceholder: 'Ajouter une opinion...',

  // Voice
  soulTone: 'Ton',
  soulToneDesc: 'Le ton général de la communication.',
  soulTonePlaceholder: 'Ex. Professionnel mais accessible',
  soulStyleRules: 'Règles de style',
  soulStyleRulesDesc: "Règles spécifiques qui régissent le style d'écriture.",
  soulStyleRulesPlaceholder: 'Ajouter une règle de style...',
  soulExamplePhrases: "Phrases d'exemple",
  soulExamplePhrasesDesc: 'Phrases typiques que cet agent utiliserait.',
  soulExamplePhrasesPlaceholder: "Ajouter une phrase d'exemple...",
  soulAntiPatterns: 'Anti-modèles',
  soulAntiPatternsDesc:
    'Phrases ou modèles que cet agent ne doit jamais utiliser.',
  soulAntiPatternsPlaceholder: 'Ajouter un anti-modèle...',

  // Cognition
  soulReasoningStyle: 'Style de raisonnement',
  soulReasoningStylePlaceholder:
    'Décrivez comment cet agent raisonne et aborde les problèmes...',
  soulExpertise: 'Expertise',
  soulExpertiseDesc:
    'Domaines de connaissance approfondie dans lesquels cet agent se spécialise.',
  soulExpertisePlaceholder:
    "Saisissez un domaine d'expertise et appuyez sur Entrée...",
  soulOperatingModes: "Modes d'opération",
  soulOperatingModesDesc: 'Modes nommés avec des comportements distincts.',
  soulModeName: 'Nom du mode',
  soulModeDescription: 'Description du comportement',
  soulApproachPrefs: "Préférences d'approche",
  soulApproachPrefsDesc:
    'Méthodes ou stratégies préférées pour aborder les tâches.',
  soulApproachPrefsPlaceholder: 'Ajouter une préférence...',

  // Boundaries
  soulRedLines: 'Lignes rouges',
  soulRedLinesDesc: 'Limites absolues qui ne doivent jamais être franchies.',
  soulRedLinesPlaceholder: 'Ajouter une limite stricte...',
  soulRequired: 'Obligatoire',
  soulEscalation: "Règles d'escalade",
  soulEscalationDesc:
    'Quand et comment escalader les problèmes vers un humain.',
  soulEscalationPlaceholder: "Ajouter une règle d'escalade...",
  soulPrivacy: 'Règles de confidentialité',
  soulPrivacyDesc:
    'Règles concernant le traitement des données sensibles ou personnelles.',
  soulPrivacyPlaceholder: 'Ajouter une règle de confidentialité...',
  soulActionLimits: "Limites d'action",
  soulActionLimitsDesc:
    "Contraintes sur les actions que l'agent peut entreprendre.",
  soulActionLimitsPlaceholder: "Ajouter une limite d'action...",

  // Evolution
  soulSelfImproving: "Mode d'auto-amélioration",
  soulSelfImprovingDesc:
    "Lorsqu'il est activé, l'agent apprend de ses erreurs et accumule des connaissances au fil du temps.",
  soulMaxCorrections: 'Corrections maximales',
  soulMaxLearnings: 'Apprentissages maximaux',
  soulLastEvolved: 'Dernière évolution : {date}',
  soulCorrections: 'Corrections',
  soulLearnings: 'Apprentissages',
  soulNoCorrections: "Aucune correction enregistrée pour l'instant.",
  soulNoLearnings: "Aucun apprentissage enregistré pour l'instant.",
  soulCorrectionIssue: 'Problème : ',
  soulCorrectionFix: 'Correctif : ',

  // Default soul values
  soulDefaultValue: 'Serviable',
  soulDefaultStyleRule: 'Soyez clair et concis',
  soulDefaultRedLine: "Ne jamais fabriquer d'information",

  // Shared UI
  soulAdd: 'Ajouter',
  soulRemove: 'Supprimer',
  soulAddItem: 'Ajouter un élément...',
  soulTypeAndEnter: 'Saisissez et appuyez sur Entrée...',

  // Templates
  soulTemplates: "Modèles d'âme",
  soulApplyTemplate: 'Appliquer le modèle',
  soulExport: "Exporter l'âme",
  soulImport: "Importer l'âme",

  // Role presets
  roleCodeReviewer: 'Réviseur de code',
  roleCodeReviewerDesc: 'Examine les pull requests et la qualité du code',
  roleSoftwareEngineer: 'Ingénieur logiciel',
  roleSoftwareEngineerDesc: 'Écrit et maintient le code',
  roleTechnicalWriter: 'Rédacteur technique',
  roleTechnicalWriterDesc: 'Crée de la documentation et des guides',
  roleResearchAssistant: 'Assistant de recherche',
  roleResearchAssistantDesc: 'Collecte et analyse des informations',
  roleDataAnalyst: 'Analyste de données',
  roleDataAnalystDesc: 'Explore et visualise les données',
  roleUiUxDeveloper: 'Développeur UI/UX',
  roleUiUxDeveloperDesc: 'Conçoit des interfaces et des composants',
  roleProjectPlanner: 'Planificateur de projet',
  roleProjectPlannerDesc: 'Planifie les tâches et les jalons',
  roleTestEngineer: 'Ingénieur de test',
  roleTestEngineerDesc: 'Écrit et exécute des tests',
  roleSecurityAuditor: 'Auditeur de sécurité',
  roleSecurityAuditorDesc: 'Analyse les vulnérabilités de sécurité',
  roleDevOpsEngineer: 'Ingénieur DevOps',
  roleDevOpsEngineerDesc: "Gère l'infrastructure et le CI/CD",

  // Profile Detail Page
  profileDetail: 'Détails du Profil',
  backToProfiles: 'Retour aux Profils',
  unsavedChanges: 'Vous avez des modifications non enregistrées',
  discardChanges: 'Annuler les Modifications',
  saving: 'Enregistrement...',
  changesSaved: 'Modifications enregistrées',
  profileNotFound: 'Profil introuvable',
  startFromScratch: 'Partir de zéro',
  tabOverview: 'Aperçu',
  tabTools: 'Outils',
  systemPromptPreview: 'Aperçu du Prompt Système',
  systemPromptPreviewDesc: 'Ceci est le prompt rendu que le LLM reçoit.',
  refreshPreview: 'Actualiser',
  noSoulForPreview: 'Configurez une âme pour voir le prompt système rendu.',
  quickSetup: 'Configuration Rapide',
  quickSetupDesc:
    'Décrivez votre agent en texte libre et nous le structurerons pour vous.',
  quickSetupPlaceholder:
    "Décrivez la personnalité, l'expertise et le comportement de votre agent...",
  autoStructure: 'Auto-structurer',
  autoStructuring: 'Structuration...',
  autoStructureSuccess:
    'Âme structurée avec succès ! Vérifiez les onglets pour affiner.',
  orChooseTemplate: 'Ou choisir un modèle',

  // Thinking config
  thinkingConfig: 'Réflexion',
  thinkingAdaptive: 'Adaptatif',
  thinkingEnabled: 'Budget fixe',
  thinkingDisabled: 'Désactivé',
  thinkingEffort: "Niveau d'effort",
  thinkingBudget: 'Tokens de budget',
  thinkingNone: 'Par défaut',
  effortLow: 'Faible',
  effortMedium: 'Moyen',
  effortHigh: 'Élevé',
  effortXhigh: 'Très élevé',
  effortMax: 'Maximum',

  // Model descriptions
  modelBalanced: 'Équilibré (par défaut)',
  modelMostCapable: 'Le plus performant',
  modelFast: 'Rapide et léger',

  // Skills picker
  skillsAllAllowed: 'Tout autoriser',
  skillsRestrict: 'Restreindre',
  skillsAllAllowedDesc:
    'Toutes les compétences, outils et capacités intégrées sont disponibles pour ce profil. Cliquez sur Restreindre pour sélectionner des compétences spécifiques.',
  skillStaleRemove: 'Compétence plus disponible — cliquez pour supprimer',
  skillsNoneInstalled:
    'Aucune compétence installée. Ajoutez des compétences dans ~/.claude/skills/ pour les activer ici.',
  maxConcurrentTasksDesc:
    "Nombre maximum de tâches que ce profil peut exécuter simultanément. Les tâches supplémentaires sont mises en file d'attente et démarrent automatiquement lorsqu'un emplacement se libère.",

  // Quickstart Wizard
  quickstartStepTemplate: 'Choisir une spécialité',
  quickstartStepPersonalize: 'Personnaliser',
  quickstartStepConfigure: 'Configurer',
  quickstartStepConfirm: 'Prêt à démarrer',
  quickstartConfigureTitle: 'Configurez votre agent',
  quickstartConfigureSubtitle:
    'Définissez le runtime, les outils et le comportement',
  quickstartWelcomeTitle: 'Choisissez la spécialité de votre agent',
  quickstartWelcomeSubtitle:
    'Chaque modèle inclut des compétences et une personnalité — choisissez-en un pour commencer',
  quickstartSkillsIncluded: '{count} compétences incluses',
  quickstartTemplateCustom: 'Personnalisé',
  quickstartTemplateCustomDesc: 'Partez de zéro et configurez tout vous-même',
  quickstartSkipSetup: "Passer — utiliser l'agent par défaut",
  quickstartBack: 'Retour',
  quickstartContinue: 'Continuer',
  quickstartDefaultName: 'Assistant général',
  quickstartSkillSingular: 'compétence',
  quickstartSkillPlural: 'compétences',
  quickstartPersonalizeTitle: 'Personnalisez votre agent',
  quickstartPersonalizeSubtitle:
    'Ajustez les bases — vous pourrez affiner plus tard',
  quickstartGreetingPreview: "Aperçu du message d'accueil",
  quickstartBundledSkills: 'Compétences incluses',
  quickstartSkipDetails: 'Utiliser les valeurs par défaut',
  quickstartConfirmTitle: 'Votre agent est prêt !',
  quickstartConfirmSummary:
    '{name} est configuré avec {skillCount} compétences et prêt à discuter',
  quickstartStartChatting: 'Commencer à discuter',
  quickstartCustomizeFurther: 'Personnaliser davantage dans les Paramètres',

  // Soul Greeting
  soulGreeting: "Message d'accueil",
  soulGreetingDesc:
    'Le premier message que votre agent envoie dans les nouvelles conversations.',
  soulGreetingPlaceholder:
    'ex., "Bonjour ! Je suis prêt à aider. Sur quoi travaillons-nous ?"',

  // Skill Bundles
  soulSkillBundles: 'Packs de Compétences',
  soulSkillBundlesDesc:
    'Flux de travail et méthodologies préconfigurés dans lesquels cet agent se spécialise.',
  soulSkillName: 'Nom de la compétence',
  soulSkillDescription: 'Description',
  soulSkillApproach: 'Méthodologie',
  soulSkillTrigger: 'Quand activer',

  // Skill i18n
  skillCodeReview: 'Revue de Code',
  skillCodeReviewDesc: 'Revue de code pré-merge pour bugs, sécurité et qualité',
  skillInvestigate: 'Investiguer',
  skillInvestigateDesc:
    'Débogage systématique de cause racine avec méthodologie en 4 phases',
  skillSecurityAudit: 'Audit de Sécurité',
  skillSecurityAuditDesc:
    'OWASP Top 10, modèle de menaces STRIDE, archéologie des secrets',
  skillBrainstorm: 'Brainstorming',
  skillBrainstormDesc:
    'Idéation structurée avec questions de cadrage et design thinking',
  skillPlanReview: 'Revue de Plan',
  skillPlanReviewDesc:
    "Revue d'ingénierie : architecture, flux de données, cas limites, matrice de tests",
  skillShip: 'Livrer',
  skillShipDesc:
    'Flux complet de livraison : tests, revue, version, changelog, PR',
  skillDocUpdate: 'Mise à Jour Doc',
  skillDocUpdateDesc:
    'Synchronisation de documentation post-livraison sur tous les docs du projet',
  skillRetro: 'Rétrospective',
  skillRetroDesc:
    "Rétrospective hebdomadaire d'ingénierie avec analyse des commits et tendances",

  // Template names
  templateFullStackDev: 'Développeur Full-Stack',
  templateFullStackDevDesc:
    'Écrit, révise, teste et débogue du code sur toute la pile',
  templateCodeReviewer: 'Réviseur de Code',
  templateCodeReviewerDesc:
    'Révise le code pour les bugs, problèmes de sécurité et bonnes pratiques',
  templateQaEngineer: 'Ingénieur QA',
  templateQaEngineerDesc:
    'Tests systématiques, détection de bugs et prévention des régressions',
  templateProjectPlanner: 'Planificateur de Projet',
  templateProjectPlannerDesc:
    'Décompose les projets en tâches avec estimations et dépendances',
  templateTechWriter: 'Rédacteur Technique',
  templateTechWriterDesc:
    'Crée une documentation claire, des références API et des tutoriels',
  templateSecurityAuditor: 'Auditeur de Sécurité',
  templateSecurityAuditorDesc:
    'Scan OWASP Top 10, modélisation des menaces et détection de secrets',
  templateResearchAnalyst: 'Analyste de Recherche',
  templateResearchAnalystDesc:
    'Recherche approfondie avec citations de sources et analyse équilibrée',
  templateDataAnalyst: 'Analyste de Données',
  templateDataAnalystDesc:
    'Exploration de données, visualisation et insights actionnables',
  templateCreativeWriter: 'Écrivain Créatif',
  templateCreativeWriterDesc:
    'Création de contenu, édition et adaptation du ton',
  templateGeneralHelper: 'Assistant Général',
  templateGeneralHelperDesc:
    'Assistant polyvalent pour les tâches et questions quotidiennes',
};
