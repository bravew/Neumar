export default {
  title: 'Perfiles de agentes',
  createProfile: 'Crear perfil',
  editProfile: 'Editar perfil',
  deleteProfile: 'Eliminar perfil',
  name: 'Nombre',
  role: 'Rol',
  description: 'Descripción',
  runtime: 'Entorno de ejecución',
  model: 'Modelo',
  status: 'Estado',
  active: 'Activo',
  paused: 'Pausado',
  archived: 'Archivado',
  systemPrompt: 'Prompt del sistema',
  noProfiles: 'Aún no hay perfiles',
  confirmDelete: '¿Estás seguro de que quieres eliminar este perfil?',
  cannotDeleteRunning: 'No se puede eliminar un perfil con tareas en ejecución',
  selectRuntime: 'Seleccionar entorno...',
  mcpServers: 'Servidores MCP',
  skills: 'Habilidades',
  maxConcurrentTasks: 'Tareas concurrentes máx.',
  taskCount: '{count} tareas',
  noTasks: 'Sin tareas',
  assignedAgent: 'Agente asignado',
  noAgent: 'Sin agente',
  unavailable: '(no disponible)',
  all: 'Todos',
  newAgent: 'Nuevo agente',
  newTask: 'Nueva tarea',
  noProfilesForFilter: 'No hay agentes para este filtro.',
  advanced: 'Avanzado',
  // Soul Editor
  soulEditor: 'Editor de alma',
  editSoul: 'Editar alma',
  chooseSoulTemplate: 'Elegir plantilla',
  soulVersion: 'Alma v{version}',
  soulManagedPrompt: 'Prompt del sistema gestionado por el Editor de alma',

  // Soul Tabs
  soulIdentity: 'Identidad',
  soulVoice: 'Voz',
  soulCognition: 'Cognición',
  soulBoundaries: 'Límites',
  soulEvolution: 'Evolución',

  // Identity
  soulRole: 'Rol',
  soulRoleDesc: 'El rol o persona principal que encarna este agente.',
  soulCoreValues: 'Valores fundamentales',
  soulCoreValuesDesc:
    'Principios rectores que moldean el comportamiento y la toma de decisiones.',
  soulCoreValuesPlaceholder: 'Agregar un valor fundamental...',
  soulWorldview: 'Visión del mundo',
  soulWorldviewPlaceholder: 'Describe cómo este agente ve el mundo...',
  soulOpinions: 'Opiniones',
  soulOpinionsDesc: 'Posturas o creencias firmes que sostiene el agente.',
  soulOpinionsPlaceholder: 'Agregar una opinión...',

  // Voice
  soulTone: 'Tono',
  soulToneDesc: 'El tono general de la comunicación.',
  soulTonePlaceholder: 'Ej. Profesional pero accesible',
  soulStyleRules: 'Reglas de estilo',
  soulStyleRulesDesc: 'Reglas específicas que rigen el estilo de escritura.',
  soulStyleRulesPlaceholder: 'Agregar una regla de estilo...',
  soulExamplePhrases: 'Frases de ejemplo',
  soulExamplePhrasesDesc: 'Frases típicas que usaría este agente.',
  soulExamplePhrasesPlaceholder: 'Agregar una frase de ejemplo...',
  soulAntiPatterns: 'Antipatrones',
  soulAntiPatternsDesc: 'Frases o patrones que este agente nunca debe usar.',
  soulAntiPatternsPlaceholder: 'Agregar un antipatrón...',

  // Cognition
  soulReasoningStyle: 'Estilo de razonamiento',
  soulReasoningStylePlaceholder:
    'Describe cómo este agente razona y aborda problemas...',
  soulExpertise: 'Experiencia',
  soulExpertiseDesc:
    'Áreas de conocimiento profundo en las que se especializa este agente.',
  soulExpertisePlaceholder:
    'Escribe un área de experiencia y presiona Enter...',
  soulOperatingModes: 'Modos de operación',
  soulOperatingModesDesc: 'Modos con nombre y comportamientos distintos.',
  soulModeName: 'Nombre del modo',
  soulModeDescription: 'Descripción del comportamiento',
  soulApproachPrefs: 'Preferencias de enfoque',
  soulApproachPrefsDesc: 'Métodos o estrategias preferidos al abordar tareas.',
  soulApproachPrefsPlaceholder: 'Agregar una preferencia...',

  // Boundaries
  soulRedLines: 'Líneas rojas',
  soulRedLinesDesc: 'Límites absolutos que nunca deben cruzarse.',
  soulRedLinesPlaceholder: 'Agregar un límite estricto...',
  soulRequired: 'Obligatorio',
  soulEscalation: 'Reglas de escalamiento',
  soulEscalationDesc: 'Cuándo y cómo escalar problemas a un humano.',
  soulEscalationPlaceholder: 'Agregar una regla de escalamiento...',
  soulPrivacy: 'Reglas de privacidad',
  soulPrivacyDesc: 'Reglas sobre el manejo de datos sensibles o personales.',
  soulPrivacyPlaceholder: 'Agregar una regla de privacidad...',
  soulActionLimits: 'Límites de acción',
  soulActionLimitsDesc:
    'Restricciones sobre las acciones que puede realizar el agente.',
  soulActionLimitsPlaceholder: 'Agregar un límite de acción...',

  // Evolution
  soulSelfImproving: 'Modo de automejora',
  soulSelfImprovingDesc:
    'Cuando está activado, el agente aprende de sus errores y acumula conocimiento con el tiempo.',
  soulMaxCorrections: 'Correcciones máximas',
  soulMaxLearnings: 'Aprendizajes máximos',
  soulLastEvolved: 'Última evolución: {date}',
  soulCorrections: 'Correcciones',
  soulLearnings: 'Aprendizajes',
  soulNoCorrections: 'Aún no se han registrado correcciones.',
  soulNoLearnings: 'Aún no se han registrado aprendizajes.',
  soulCorrectionIssue: 'Problema: ',
  soulCorrectionFix: 'Solución: ',

  // Default soul values
  soulDefaultValue: 'Servicial',
  soulDefaultStyleRule: 'Sé claro y conciso',
  soulDefaultRedLine: 'Nunca fabricar información',

  // Shared UI
  soulAdd: 'Agregar',
  soulRemove: 'Eliminar',
  soulAddItem: 'Agregar elemento...',
  soulTypeAndEnter: 'Escribe y presiona Enter...',

  // Templates
  soulTemplates: 'Plantillas de alma',
  soulApplyTemplate: 'Aplicar plantilla',
  soulExport: 'Exportar alma',
  soulImport: 'Importar alma',

  // Role presets
  roleCodeReviewer: 'Revisor de código',
  roleCodeReviewerDesc: 'Revisa pull requests y calidad de código',
  roleSoftwareEngineer: 'Ingeniero de software',
  roleSoftwareEngineerDesc: 'Escribe y mantiene código',
  roleTechnicalWriter: 'Redactor técnico',
  roleTechnicalWriterDesc: 'Crea documentación y guías',
  roleResearchAssistant: 'Asistente de investigación',
  roleResearchAssistantDesc: 'Recopila y analiza información',
  roleDataAnalyst: 'Analista de datos',
  roleDataAnalystDesc: 'Explora y visualiza datos',
  roleUiUxDeveloper: 'Desarrollador UI/UX',
  roleUiUxDeveloperDesc: 'Diseña interfaces y componentes',
  roleProjectPlanner: 'Planificador de proyectos',
  roleProjectPlannerDesc: 'Planifica tareas e hitos',
  roleTestEngineer: 'Ingeniero de pruebas',
  roleTestEngineerDesc: 'Escribe y ejecuta pruebas',
  roleSecurityAuditor: 'Auditor de seguridad',
  roleSecurityAuditorDesc: 'Analiza vulnerabilidades de seguridad',
  roleDevOpsEngineer: 'Ingeniero DevOps',
  roleDevOpsEngineerDesc: 'Gestiona infraestructura y CI/CD',

  // Profile Detail Page
  profileDetail: 'Detalles del Perfil',
  backToProfiles: 'Volver a Perfiles',
  unsavedChanges: 'Tienes cambios sin guardar',
  discardChanges: 'Descartar Cambios',
  saving: 'Guardando...',
  changesSaved: 'Cambios guardados',
  profileNotFound: 'Perfil no encontrado',
  startFromScratch: 'Empezar desde cero',
  tabOverview: 'General',
  tabTools: 'Herramientas',
  systemPromptPreview: 'Vista Previa del Prompt',
  systemPromptPreviewDesc: 'Este es el prompt renderizado que recibe el LLM.',
  refreshPreview: 'Actualizar',
  noSoulForPreview:
    'Configura un alma para ver el prompt del sistema renderizado.',
  quickSetup: 'Configuración Rápida',
  quickSetupDesc:
    'Describe tu agente en texto plano y lo estructuraremos por ti.',
  quickSetupPlaceholder:
    'Describe la personalidad, experiencia y comportamiento de tu agente...',
  autoStructure: 'Auto-estructurar',
  autoStructuring: 'Estructurando...',
  autoStructureSuccess:
    'Alma estructurada con éxito. Revisa las pestañas para ajustar.',
  orChooseTemplate: 'O elige una plantilla',

  // Thinking config
  thinkingConfig: 'Pensamiento',
  thinkingAdaptive: 'Adaptativo',
  thinkingEnabled: 'Presupuesto fijo',
  thinkingDisabled: 'Desactivado',
  thinkingEffort: 'Nivel de esfuerzo',
  thinkingBudget: 'Tokens de presupuesto',
  thinkingNone: 'Predeterminado',
  effortLow: 'Bajo',
  effortMedium: 'Medio',
  effortHigh: 'Alto',
  effortXhigh: 'Extra alto',
  effortMax: 'Máximo',

  // Model descriptions
  modelBalanced: 'Equilibrado (predeterminado)',
  modelMostCapable: 'Más capaz',
  modelFast: 'Rápido y ligero',

  // Skills picker
  skillsAllAllowed: 'Permitir todo',
  skillsRestrict: 'Restringir',
  skillsAllAllowedDesc:
    'Todas las habilidades, herramientas y capacidades integradas están disponibles para este perfil. Haz clic en Restringir para seleccionar habilidades específicas.',
  skillStaleRemove: 'Habilidad ya no disponible — clic para eliminar',
  skillsNoneInstalled:
    'No hay habilidades instaladas. Agrega habilidades a ~/.claude/skills/ para habilitarlas aquí.',
  maxConcurrentTasksDesc:
    'Cantidad máxima de tareas que este perfil puede ejecutar simultáneamente. Las tareas adicionales se encolan y comienzan automáticamente cuando hay un espacio disponible.',

  // Quickstart Wizard
  quickstartStepTemplate: 'Elige una especialidad',
  quickstartStepPersonalize: 'Personaliza',
  quickstartStepConfigure: 'Configurar',
  quickstartStepConfirm: 'Listo para empezar',
  quickstartConfigureTitle: 'Configura tu agente',
  quickstartConfigureSubtitle:
    'Configura el runtime, herramientas y comportamiento',
  quickstartWelcomeTitle: 'Elige la especialidad de tu agente',
  quickstartWelcomeSubtitle:
    'Cada plantilla incluye habilidades y personalidad — elige una para comenzar',
  quickstartSkillsIncluded: '{count} habilidades incluidas',
  quickstartTemplateCustom: 'Personalizado',
  quickstartTemplateCustomDesc: 'Empieza desde cero y configura todo tú mismo',
  quickstartSkipSetup: 'Omitir — usar agente predeterminado',
  quickstartBack: 'Atrás',
  quickstartContinue: 'Continuar',
  quickstartDefaultName: 'Asistente general',
  quickstartSkillSingular: 'habilidad',
  quickstartSkillPlural: 'habilidades',
  quickstartPersonalizeTitle: 'Personaliza tu agente',
  quickstartPersonalizeSubtitle:
    'Ajusta lo básico — puedes afinarlo todo después',
  quickstartGreetingPreview: 'Vista previa del saludo',
  quickstartBundledSkills: 'Habilidades incluidas',
  quickstartSkipDetails: 'Usar valores predeterminados',
  quickstartConfirmTitle: '¡Tu agente está listo!',
  quickstartConfirmSummary:
    '{name} está configurado con {skillCount} habilidades y listo para chatear',
  quickstartStartChatting: 'Comenzar a chatear',
  quickstartCustomizeFurther: 'Personalizar más en Configuración',

  // Soul Greeting
  soulGreeting: 'Saludo',
  soulGreetingDesc:
    'El primer mensaje que tu agente envía en nuevas conversaciones.',
  soulGreetingPlaceholder:
    'ej., "¡Hola! Estoy listo para ayudar. ¿En qué trabajamos?"',

  // Skill Bundles
  soulSkillBundles: 'Paquetes de Habilidades',
  soulSkillBundlesDesc:
    'Flujos de trabajo y metodologías preconfigurados en los que se especializa este agente.',
  soulSkillName: 'Nombre de habilidad',
  soulSkillDescription: 'Descripción',
  soulSkillApproach: 'Metodología',
  soulSkillTrigger: 'Cuándo activar',

  // Skill i18n
  skillCodeReview: 'Revisión de Código',
  skillCodeReviewDesc:
    'Revisión de código pre-merge para bugs, seguridad y calidad',
  skillInvestigate: 'Investigar',
  skillInvestigateDesc:
    'Depuración sistemática de causa raíz con metodología de 4 fases',
  skillSecurityAudit: 'Auditoría de Seguridad',
  skillSecurityAuditDesc:
    'OWASP Top 10, modelo de amenazas STRIDE, arqueología de secretos',
  skillBrainstorm: 'Lluvia de Ideas',
  skillBrainstormDesc:
    'Ideación estructurada con preguntas forzadas y design thinking',
  skillPlanReview: 'Revisión de Plan',
  skillPlanReviewDesc:
    'Revisión de ingeniería: arquitectura, flujo de datos, casos extremos, matriz de pruebas',
  skillShip: 'Enviar',
  skillShipDesc:
    'Flujo completo de envío: pruebas, revisión, versión, changelog, PR',
  skillDocUpdate: 'Actualizar Docs',
  skillDocUpdateDesc:
    'Sincronización de documentación post-envío en todos los docs del proyecto',
  skillRetro: 'Retrospectiva',
  skillRetroDesc:
    'Retrospectiva semanal de ingeniería con análisis de commits y tendencias',

  // Template names
  templateFullStackDev: 'Desarrollador Full-Stack',
  templateFullStackDevDesc:
    'Escribe, revisa, prueba y depura código en toda la pila',
  templateCodeReviewer: 'Revisor de Código',
  templateCodeReviewerDesc:
    'Revisa código en busca de bugs, problemas de seguridad y mejores prácticas',
  templateQaEngineer: 'Ingeniero QA',
  templateQaEngineerDesc:
    'Pruebas sistemáticas, búsqueda de errores y prevención de regresiones',
  templateProjectPlanner: 'Planificador de Proyectos',
  templateProjectPlannerDesc:
    'Descompone proyectos en tareas con estimaciones y dependencias',
  templateTechWriter: 'Escritor Técnico',
  templateTechWriterDesc:
    'Crea documentación clara, referencias de API y tutoriales',
  templateSecurityAuditor: 'Auditor de Seguridad',
  templateSecurityAuditorDesc:
    'Escaneo OWASP Top 10, modelado de amenazas y detección de secretos',
  templateResearchAnalyst: 'Analista de Investigación',
  templateResearchAnalystDesc:
    'Investigación profunda con citas de fuentes y análisis equilibrado',
  templateDataAnalyst: 'Analista de Datos',
  templateDataAnalystDesc:
    'Exploración de datos, visualización e insights accionables',
  templateCreativeWriter: 'Escritor Creativo',
  templateCreativeWriterDesc:
    'Creación de contenido, edición y adaptación de tono',
  templateGeneralHelper: 'Asistente General',
  templateGeneralHelperDesc:
    'Asistente versátil para tareas y preguntas cotidianas',
};
