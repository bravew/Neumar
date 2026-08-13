export default {
  title: 'Conectores',
  subtitle:
    'Conecte contas SaaS e escolha quais ferramentas os agentes podem usar.',
  composioSectionTitle: 'Composio (gerenciado)',
  composioSectionDescription:
    'OAuth gerenciado e execução de ferramentas hospedada para centenas de conectores SaaS.',
  accessPolicySectionTitle: 'Política de acesso',
  accessPolicySectionDescription:
    'Defina qual nível de permissão pode usar cada conector a partir de plataformas de chat.',
  groupYourAccounts: 'Suas contas',
  groupYourAccountsDescription:
    'Conexões OAuth a provedores que você possui ou autorizou.',
  groupCatalog: 'Catálogo',
  groupCatalogDescription:
    'Explore e conecte ferramentas SaaS via OAuth gerenciado pela Composio.',
  groupGovernance: 'Governança',
  groupGovernanceDescription:
    'Níveis de permissão por conector para uso a partir do chat.',
  composioCard: {
    title: 'Chave API da Composio',
    subtitle: 'OAuth gerenciado e execução hospedada para conectores em nuvem.',
    customAuthNotice:
      'Antes de conectar toolkits OAuth, configure Custom Auth no seu projeto da Composio para cada toolkit. A Neuma usa essas auth configs para criar sessões de conector por usuário.',
    configuredLabel: 'Configurado',
    notConfiguredLabel: 'Não configurado',
    saveButton: 'Salvar',
    editButton: 'Editar',
    apiKeyButton: 'Obter chave API',
    refreshButton: 'Atualizar catálogo',
    savedToast: 'Salvo',
    error: 'Não foi possível salvar as configurações da Composio',
  },
  catalog: {
    searchPlaceholder: 'Buscar conectores',
    searchLabel: 'Buscar conectores',
    searchClear: 'Limpar busca de conectores',
    filterAriaLabel: 'Filtrar conectores por {filter}',
    filters: {
      all: 'Todos',
      connected: 'Conectados',
      available: 'Disponíveis',
      recommended: 'Sugeridos',
      native: 'Nativos',
    },
    sortLabel: 'Ordenar conectores',
    sortRecommended: 'Sugeridos',
    sortName: 'Nome A-Z',
    sortTools: 'Quantidade de ferramentas',
    loading: 'Carregando...',
    empty: 'Nenhum conector encontrado.',
  },
  card: {
    openLabel: 'Abrir conector {name}',
    apiKeyLabel: 'Obter chave API para {name}',
    apiKeyButton: 'Obter chave API',
    toolsLabel: '{count} ferramentas',
    connectedAs: 'Conectado como {label}',
    statusConnected: 'Conectado',
    statusAvailable: 'Disponível',
    statusPending: 'Pendente',
    statusError: 'Erro',
    statusDisabled: 'Desativado',
  },
  auth: {
    manageAccount: 'Gerenciar conta',
    connect: 'Conectar',
    connecting: 'Conectando…',
    disconnect: 'Desconectar',
    disconnecting: 'Desconectando…',
    disconnectConfirm:
      'Desconectar {name}? Os agentes perderão acesso às suas ferramentas.',
    missingRedirect: 'O conector não retornou uma URL de autorização.',
    nativeHelp:
      'Gerencie credenciais nativas nas configurações avançadas existentes.',
    cancel: 'Cancelar',
  },
  detail: {
    fallbackTitle: 'Conector',
    fallbackDescription: 'Detalhes do conector e política de ferramentas.',
    loading: 'Carregando...',
    statusLabel: 'Status',
    categoryLabel: 'Categoria',
    providerLabel: 'Provedor',
    accountLabel: 'Conta',
    connectedLabel: 'Conectado',
    expiresLabel: 'Expira',
    lastErrorLabel: 'Último erro',
  },
  scopes: {
    title: 'Escopos',
    subtitle:
      'Conexões de canal ficam isoladas por plataforma, configuração do bot e usuário.',
    desktop: 'Desktop',
    channelUnavailable: 'Não conectado para este canal',
    requiresDesktopApproval: 'Escritas exigem aprovação no desktop na v1.',
    developerDetails: 'Detalhes de desenvolvedor',
    defaultScopes: {
      desktop: 'Desktop',
      slack: 'Slack',
      discord: 'Discord',
      telegram: 'Telegram',
      lark: 'Lark',
      whatsApp: 'WhatsApp',
      iMessage: 'iMessage',
    },
    defaultScopeDetail:
      'Apenas ferramentas de leitura até conectar este escopo.',
  },
  tools: {
    title: 'Ferramentas',
    hideTools: 'Ocultar ferramentas',
    showAllTools: 'Mostrar todas as {count} ferramentas',
    toggleApproval: 'Alternar aprovação para {tool}',
  },
  permissions: {
    title: 'Permissões',
  },
  nativeOverride: {
    description:
      'Este conector é fornecido pela integração nativa do Neuma, então o roteamento de canal e o escopo das credenciais ficam sob política local.',
  },
};
