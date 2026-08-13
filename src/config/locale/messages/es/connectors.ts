export default {
  title: 'Conectores',
  subtitle:
    'Conecta cuentas SaaS y elige qué herramientas pueden usar los agentes.',
  composioSectionTitle: 'Composio (gestionado)',
  composioSectionDescription:
    'OAuth gestionado y ejecución de herramientas alojada para cientos de conectores SaaS.',
  accessPolicySectionTitle: 'Política de acceso',
  accessPolicySectionDescription:
    'Define qué nivel de permiso puede usar cada conector desde plataformas de chat.',
  groupYourAccounts: 'Tus cuentas',
  groupYourAccountsDescription:
    'Conexiones OAuth a proveedores que posees o has autorizado.',
  groupCatalog: 'Catálogo',
  groupCatalogDescription:
    'Explora y conecta herramientas SaaS mediante OAuth gestionado por Composio.',
  groupGovernance: 'Gobernanza',
  groupGovernanceDescription:
    'Niveles de permiso por conector para el uso desde chat.',
  composioCard: {
    title: 'Clave API de Composio',
    subtitle:
      'OAuth gestionado y ejecución alojada para conectores en la nube.',
    customAuthNotice:
      'Antes de conectar toolkits OAuth, configura Custom Auth en tu proyecto de Composio para cada toolkit. Neuma usa esas auth configs para crear sesiones de conector por usuario.',
    configuredLabel: 'Configurado',
    notConfiguredLabel: 'Sin configurar',
    saveButton: 'Guardar',
    editButton: 'Editar',
    apiKeyButton: 'Obtener clave API',
    refreshButton: 'Actualizar catálogo',
    savedToast: 'Guardado',
    error: 'No se pudo guardar la configuración de Composio',
  },
  catalog: {
    searchPlaceholder: 'Buscar conectores',
    searchLabel: 'Buscar conectores',
    searchClear: 'Limpiar búsqueda de conectores',
    filterAriaLabel: 'Filtrar conectores por {filter}',
    filters: {
      all: 'Todos',
      connected: 'Conectados',
      available: 'Disponibles',
      recommended: 'Sugeridos',
      native: 'Nativos',
    },
    sortLabel: 'Ordenar conectores',
    sortRecommended: 'Sugeridos',
    sortName: 'Nombre A-Z',
    sortTools: 'Cantidad de herramientas',
    loading: 'Cargando...',
    empty: 'No se encontraron conectores.',
  },
  card: {
    openLabel: 'Abrir conector {name}',
    apiKeyLabel: 'Obtener clave API para {name}',
    apiKeyButton: 'Obtener clave API',
    toolsLabel: '{count} herramientas',
    connectedAs: 'Conectado como {label}',
    statusConnected: 'Conectado',
    statusAvailable: 'Disponible',
    statusPending: 'Pendiente',
    statusError: 'Error',
    statusDisabled: 'Desactivado',
  },
  auth: {
    manageAccount: 'Administrar cuenta',
    connect: 'Conectar',
    connecting: 'Conectando…',
    disconnect: 'Desconectar',
    disconnecting: 'Desconectando…',
    disconnectConfirm:
      '¿Desconectar {name}? Los agentes perderán acceso a sus herramientas.',
    missingRedirect: 'El conector no devolvió una URL de autorización.',
    nativeHelp:
      'Administra las credenciales nativas en la configuración avanzada existente.',
    cancel: 'Cancelar',
  },
  detail: {
    fallbackTitle: 'Conector',
    fallbackDescription: 'Detalles del conector y política de herramientas.',
    loading: 'Cargando...',
    statusLabel: 'Estado',
    categoryLabel: 'Categoría',
    providerLabel: 'Proveedor',
    accountLabel: 'Cuenta',
    connectedLabel: 'Conectado',
    expiresLabel: 'Expira',
    lastErrorLabel: 'Último error',
  },
  scopes: {
    title: 'Ámbitos',
    subtitle:
      'Las conexiones de canal se aíslan por plataforma, configuración del bot y usuario.',
    desktop: 'Escritorio',
    channelUnavailable: 'No conectado para este canal',
    requiresDesktopApproval:
      'Las escrituras requieren aprobación de escritorio en v1.',
    developerDetails: 'Detalles de desarrollador',
    defaultScopes: {
      desktop: 'Escritorio',
      slack: 'Slack',
      discord: 'Discord',
      telegram: 'Telegram',
      lark: 'Lark',
      whatsApp: 'WhatsApp',
      iMessage: 'iMessage',
    },
    defaultScopeDetail:
      'Solo herramientas de lectura hasta conectar este ámbito.',
  },
  tools: {
    title: 'Herramientas',
    hideTools: 'Ocultar herramientas',
    showAllTools: 'Mostrar las {count} herramientas',
    toggleApproval: 'Cambiar aprobación para {tool}',
  },
  permissions: {
    title: 'Permisos',
  },
  nativeOverride: {
    description:
      'Este conector lo proporciona la integración nativa de Neuma, por lo que el enrutamiento de canales y el ámbito de credenciales permanecen bajo la política local.',
  },
};
