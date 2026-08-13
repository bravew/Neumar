export default {
  save: 'Guardar',
  cancel: 'Cancelar',
  delete: 'Eliminar',
  edit: 'Editar',
  confirm: 'Confirmar',
  reset: 'Restablecer',
  close: 'Cerrar',
  more: 'Ver todo...',
  loading: 'Cargando...',
  noData: 'Nada por aquí todavía',
  search: 'Buscar',
  add: 'Agregar',
  remove: 'Eliminar',
  yes: 'Sí',
  no: 'No',
  ok: 'Aceptar',
  back: 'Volver',
  next: 'Siguiente',
  done: 'Listo',
  error: 'Error',
  success: 'Éxito',
  warning: 'Advertencia',
  info: 'Información',
  showMore: 'Mostrar más',
  showLess: 'Mostrar menos',
  showMoreCount: '{count} más',

  // Acciones genéricas
  dismiss: 'Descartar',
  refresh: 'Actualizar',
  stop: 'Detener',

  // Desplazamiento
  scrollToBottom: 'Ir al final',

  // Acciones de tarea
  favorite: 'Agregar a favoritos',
  unfavorite: 'Quitar de favoritos',
  deleteTask: 'Eliminar tarea',
  deleteTaskConfirm: '¿Eliminar esta tarea?',
  deleteTaskDescription:
    'Esta acción no se puede deshacer. Todos los mensajes y archivos de esta tarea se eliminarán permanentemente.',
  deleteSessionFolder: 'También eliminar carpeta de sesión',
  deleteSessionFolderDescription:
    'Esto eliminará permanentemente todos los archivos en la carpeta de sesión del disco.',
  sessionFolderPath: 'Carpeta de sesión:',
  viewFolder: 'Abrir carpeta',
  renameTitle: 'Renombrar',
  renameTitlePlaceholder: 'Introduce un nuevo título...',
  regenerateTitle: 'Regenerar título',
  regeneratingTitle: 'Generando...',

  // Mensajes de error de API
  errors: {
    connectionFailed: 'Conectando — un momento...',
    connectionFailedFinal:
      'No se pudo conectar al servicio. Verifica tu conexión e inténtalo de nuevo.',
    corsError: 'Solicitud bloqueada. Verifica la configuración del servicio',
    timeout: 'Tiempo de espera agotado. Inténtalo de nuevo',
    serverNotRunning:
      'El servicio del agente no está en ejecución. Inicia la aplicación primero.',
    requestFailed: 'Algo salió mal: {message}',
    retrying: 'Reintentando ({attempt}/{max})...',
    internalError:
      'Error interno del servidor. Consulta el archivo de registro: {logPath}',
    customApiError:
      'La API personalizada ({baseUrl}) puede no ser compatible con Claude Code SDK. Verifica la configuración de la API o prueba con otro proveedor. Archivo de registro: {logPath}',
    openLogFile: 'Ver archivo de registro',
    modelNotConfigured:
      'Aún no se ha configurado un modelo de IA. Ve a Configuración para establecer tu endpoint, clave y modelo.',
    claudeCodeNotFound:
      'Claude Code no está instalado o no está disponible. Configura un modelo de IA personalizado en Configuración, o instala Claude Code (npm install -g @anthropic-ai/claude-code)',
    configureModel: 'Configurar modelo',
    apiKeyError:
      'Error en la solicitud al modelo de IA. Verifica la configuración del modelo (URL de API, clave API, nombre del modelo, etc.)',
    configureApiKey: 'Abrir Configuración',
    agentProcessError:
      'El agente encontró un problema. Verifica la configuración del modelo e inténtalo de nuevo.',
    contextOverflow:
      'Se alcanzó el límite de la ventana de contexto para {model}. La conversación es demasiado larga para este modelo.',
    contextOverflowNewSession: 'Nueva sesión',
    contextOverflowSwitchModel: 'Cambiar modelo',
  },

  // Entrada de pregunta
  questionInput: {
    needsInput: 'Se necesita tu respuesta',
    submit: 'Enviar',
    other: 'Otro',
    customInput: 'Respuesta personalizada',
    placeholder: 'Escribe tu respuesta...',
  },

  // Diálogo de retroalimentación
  feedback: {
    title: 'Enviar comentarios',
    description:
      'Ayúdanos a mejorar compartiendo tus ideas, reportando problemas o solicitando funciones.',
    categoryLabel: 'Categoría',
    categoryBugReport: 'Reporte de error',
    categoryFeatureRequest: 'Solicitud de función',
    categoryGeneralFeedback: 'Comentario general',
    categoryQuestion: 'Pregunta',
    subjectLabel: 'Asunto',
    subjectPlaceholder: 'Resumen breve de tu comentario',
    descriptionLabel: 'Descripción',
    descriptionPlaceholderBug:
      '¿Qué ocurrió? ¿Qué esperabas? Pasos para reproducir...',
    descriptionPlaceholderFeature:
      'Describe la función que te gustaría y por qué sería útil...',
    descriptionPlaceholderFeedback:
      'Comparte tus ideas, sugerencias o experiencia...',
    descriptionPlaceholderQuestion:
      '¿Qué te gustaría saber? Por favor, sé lo más específico posible...',
    emailLabel: 'Correo electrónico (opcional)',
    emailPlaceholder: 'tu@email.com — para que podamos dar seguimiento',
    submit: 'Enviar comentarios',
    submitting: 'Enviando...',
    successTitle: '¡Gracias!',
    successMessage:
      'Tus comentarios han sido enviados. ¡Agradecemos tu aporte!',
    errorMessage:
      'No se pudieron enviar los comentarios. Por favor, inténtalo de nuevo.',
    sendAnother: 'Enviar otro',
    menuLabel: 'Enviar comentarios',
  },

  // Modal de seguridad de enlaces
  linkSafety: {
    openExternalLink: '¿Abrir enlace externo?',
    externalLinkWarning: 'Estás a punto de visitar un sitio web externo.',
    copyLink: 'Copiar enlace',
    copied: 'Copiado',
    openLink: 'Abrir enlace',
  },
};
