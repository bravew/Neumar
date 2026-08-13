export default {
  title: 'Connecteurs',
  subtitle:
    'Connectez des comptes SaaS et choisissez les outils disponibles aux agents.',
  composioSectionTitle: 'Composio (géré)',
  composioSectionDescription:
    "OAuth géré et exécution d'outils hébergée pour des centaines de connecteurs SaaS.",
  accessPolicySectionTitle: "Politique d'accès",
  accessPolicySectionDescription:
    'Choisissez quel niveau de permission peut utiliser chaque connecteur depuis les plateformes de chat.',
  groupYourAccounts: 'Vos comptes',
  groupYourAccountsDescription:
    'Connexions OAuth aux fournisseurs que vous possédez ou avez autorisés.',
  groupCatalog: 'Catalogue',
  groupCatalogDescription:
    "Parcourez et connectez des outils SaaS via l'OAuth géré par Composio.",
  groupGovernance: 'Gouvernance',
  groupGovernanceDescription:
    "Niveaux de permission par connecteur pour l'usage depuis le chat.",
  composioCard: {
    title: 'Clé API Composio',
    subtitle: 'OAuth géré et exécution hébergée pour les connecteurs cloud.',
    customAuthNotice:
      'Avant de connecter des toolkits OAuth, configurez Custom Auth dans votre projet Composio pour chaque toolkit. Neuma utilise ces auth configs pour créer des sessions de connecteur par utilisateur.',
    configuredLabel: 'Configuré',
    notConfiguredLabel: 'Non configuré',
    saveButton: 'Enregistrer',
    editButton: 'Modifier',
    apiKeyButton: 'Obtenir la clé API',
    refreshButton: 'Actualiser le catalogue',
    savedToast: 'Enregistré',
    error: 'Impossible d’enregistrer les paramètres Composio',
  },
  catalog: {
    searchPlaceholder: 'Rechercher des connecteurs',
    searchLabel: 'Rechercher des connecteurs',
    searchClear: 'Effacer la recherche de connecteurs',
    filterAriaLabel: 'Filtrer les connecteurs par {filter}',
    filters: {
      all: 'Tous',
      connected: 'Connectés',
      available: 'Disponibles',
      recommended: 'Suggérés',
      native: 'Natifs',
    },
    sortLabel: 'Trier les connecteurs',
    sortRecommended: 'Suggérés',
    sortName: 'Nom A-Z',
    sortTools: "Nombre d'outils",
    loading: 'Chargement...',
    empty: 'Aucun connecteur trouvé.',
  },
  card: {
    openLabel: 'Ouvrir le connecteur {name}',
    apiKeyLabel: 'Obtenir la clé API pour {name}',
    apiKeyButton: 'Obtenir la clé API',
    toolsLabel: '{count} outils',
    connectedAs: 'Connecté en tant que {label}',
    statusConnected: 'Connecté',
    statusAvailable: 'Disponible',
    statusPending: 'En attente',
    statusError: 'Erreur',
    statusDisabled: 'Désactivé',
  },
  auth: {
    manageAccount: 'Gérer le compte',
    connect: 'Connecter',
    connecting: 'Connexion…',
    disconnect: 'Déconnecter',
    disconnecting: 'Déconnexion…',
    disconnectConfirm:
      'Déconnecter {name} ? Les agents perdront l’accès à ses outils.',
    missingRedirect: 'Le connecteur n’a pas renvoyé d’URL d’autorisation.',
    nativeHelp:
      'Gérez les identifiants natifs dans les paramètres avancés existants.',
    cancel: 'Annuler',
  },
  detail: {
    fallbackTitle: 'Connecteur',
    fallbackDescription: 'Détails du connecteur et politique des outils.',
    loading: 'Chargement...',
    statusLabel: 'Statut',
    categoryLabel: 'Catégorie',
    providerLabel: 'Fournisseur',
    accountLabel: 'Compte',
    connectedLabel: 'Connecté',
    expiresLabel: 'Expire',
    lastErrorLabel: 'Dernière erreur',
  },
  scopes: {
    title: 'Périmètres',
    subtitle:
      'Les connexions de canal restent isolées par plateforme, configuration de bot et utilisateur.',
    desktop: 'Bureau',
    channelUnavailable: 'Non connecté pour ce canal',
    requiresDesktopApproval:
      'Les écritures nécessitent une approbation bureau en v1.',
    developerDetails: 'Détails développeur',
    defaultScopes: {
      desktop: 'Bureau',
      slack: 'Slack',
      discord: 'Discord',
      telegram: 'Telegram',
      lark: 'Lark',
      whatsApp: 'WhatsApp',
      iMessage: 'iMessage',
    },
    defaultScopeDetail:
      'Outils en lecture seule jusqu’à la connexion de ce périmètre.',
  },
  tools: {
    title: 'Outils',
    hideTools: 'Masquer les outils',
    showAllTools: 'Afficher les {count} outils',
    toggleApproval: 'Basculer l’approbation pour {tool}',
  },
  permissions: {
    title: 'Autorisations',
  },
  nativeOverride: {
    description:
      'Ce connecteur est fourni par l’intégration native de Neuma, ce qui garde le routage de canal et le périmètre des identifiants sous politique locale.',
  },
};
