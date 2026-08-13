export default {
  title: 'Perfis de agentes',
  createProfile: 'Criar perfil',
  editProfile: 'Editar perfil',
  deleteProfile: 'Excluir perfil',
  name: 'Nome',
  role: 'Função',
  description: 'Descrição',
  runtime: 'Ambiente de execução',
  model: 'Modelo',
  status: 'Status',
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
  systemPrompt: 'Prompt do sistema',
  noProfiles: 'Nenhum perfil ainda',
  confirmDelete: 'Tem certeza de que deseja excluir este perfil?',
  cannotDeleteRunning: 'Não é possível excluir perfil com tarefas em execução',
  selectRuntime: 'Selecionar ambiente...',
  mcpServers: 'Servidores MCP',
  skills: 'Habilidades',
  maxConcurrentTasks: 'Tarefas simultâneas máx.',
  taskCount: '{count} tarefas',
  noTasks: 'Sem tarefas',
  assignedAgent: 'Agente atribuído',
  noAgent: 'Sem agente',
  unavailable: '(indisponível)',
  all: 'Todos',
  newAgent: 'Novo agente',
  newTask: 'Nova tarefa',
  noProfilesForFilter: 'Nenhum agente corresponde a este filtro.',
  advanced: 'Avançado',
  // Soul Editor
  soulEditor: 'Editor de Alma',
  editSoul: 'Editar Alma',
  chooseSoulTemplate: 'Escolher Modelo',
  soulVersion: 'Alma v{version}',
  soulManagedPrompt: 'Prompt do sistema gerenciado pelo Editor de Alma',

  // Soul Tabs
  soulIdentity: 'Identidade',
  soulVoice: 'Voz',
  soulCognition: 'Cognição',
  soulBoundaries: 'Limites',
  soulEvolution: 'Evolução',

  // Identity
  soulRole: 'Papel',
  soulRoleDesc: 'O papel ou persona principal que este agente representa.',
  soulCoreValues: 'Valores Fundamentais',
  soulCoreValuesDesc:
    'Princípios orientadores que moldam o comportamento e a tomada de decisões.',
  soulCoreValuesPlaceholder: 'Adicionar um valor fundamental...',
  soulWorldview: 'Visão de Mundo',
  soulWorldviewPlaceholder: 'Descreva como este agente enxerga o mundo...',
  soulOpinions: 'Opiniões',
  soulOpinionsDesc: 'Posições firmes ou crenças que o agente sustenta.',
  soulOpinionsPlaceholder: 'Adicionar uma opinião...',

  // Voice
  soulTone: 'Tom',
  soulToneDesc: 'O tom geral da comunicação.',
  soulTonePlaceholder: 'ex.: Profissional, porém acessível',
  soulStyleRules: 'Regras de Estilo',
  soulStyleRulesDesc: 'Regras específicas que governam o estilo de escrita.',
  soulStyleRulesPlaceholder: 'Adicionar uma regra de estilo...',
  soulExamplePhrases: 'Frases de Exemplo',
  soulExamplePhrasesDesc: 'Frases típicas que este agente usaria.',
  soulExamplePhrasesPlaceholder: 'Adicionar uma frase de exemplo...',
  soulAntiPatterns: 'Antipadrões',
  soulAntiPatternsDesc: 'Frases ou padrões que este agente nunca deve usar.',
  soulAntiPatternsPlaceholder: 'Adicionar um antipadrão...',

  // Cognition
  soulReasoningStyle: 'Estilo de Raciocínio',
  soulReasoningStylePlaceholder:
    'Descreva como este agente raciocina e aborda problemas...',
  soulExpertise: 'Especialização',
  soulExpertiseDesc:
    'Áreas de conhecimento profundo nas quais este agente é especialista.',
  soulExpertisePlaceholder:
    'Digite a área de especialização e pressione Enter...',
  soulOperatingModes: 'Modos de Operação',
  soulOperatingModesDesc: 'Modos nomeados com comportamentos distintos.',
  soulModeName: 'Nome do modo',
  soulModeDescription: 'Descrição do comportamento',
  soulApproachPrefs: 'Preferências de Abordagem',
  soulApproachPrefsDesc:
    'Métodos ou estratégias preferidos ao lidar com tarefas.',
  soulApproachPrefsPlaceholder: 'Adicionar uma preferência...',

  // Boundaries
  soulRedLines: 'Linhas Vermelhas',
  soulRedLinesDesc: 'Limites absolutos que nunca devem ser ultrapassados.',
  soulRedLinesPlaceholder: 'Adicionar um limite rígido...',
  soulRequired: 'Obrigatório',
  soulEscalation: 'Regras de Escalonamento',
  soulEscalationDesc: 'Quando e como escalonar problemas para um humano.',
  soulEscalationPlaceholder: 'Adicionar uma regra de escalonamento...',
  soulPrivacy: 'Regras de Privacidade',
  soulPrivacyDesc: 'Regras sobre o tratamento de dados sensíveis ou pessoais.',
  soulPrivacyPlaceholder: 'Adicionar uma regra de privacidade...',
  soulActionLimits: 'Limites de Ação',
  soulActionLimitsDesc: 'Restrições sobre quais ações o agente pode realizar.',
  soulActionLimitsPlaceholder: 'Adicionar um limite de ação...',

  // Evolution
  soulSelfImproving: 'Modo de Autoaperfeiçoamento',
  soulSelfImprovingDesc:
    'Quando ativado, o agente aprende com erros e acumula conhecimento ao longo do tempo.',
  soulMaxCorrections: 'Máximo de Correções',
  soulMaxLearnings: 'Máximo de Aprendizados',
  soulLastEvolved: 'Última evolução: {date}',
  soulCorrections: 'Correções',
  soulLearnings: 'Aprendizados',
  soulNoCorrections: 'Nenhuma correção registrada ainda.',
  soulNoLearnings: 'Nenhum aprendizado registrado ainda.',
  soulCorrectionIssue: 'Problema: ',
  soulCorrectionFix: 'Correção: ',

  // Default soul values
  soulDefaultValue: 'Prestativo',
  soulDefaultStyleRule: 'Seja claro e conciso',
  soulDefaultRedLine: 'Nunca fabricar informações',

  // Shared UI
  soulAdd: 'Adicionar',
  soulRemove: 'Remover',
  soulAddItem: 'Adicionar item...',
  soulTypeAndEnter: 'Digite e pressione Enter...',

  // Templates
  soulTemplates: 'Modelos de Alma',
  soulApplyTemplate: 'Aplicar Modelo',
  soulExport: 'Exportar Alma',
  soulImport: 'Importar Alma',

  // Role presets
  roleCodeReviewer: 'Revisor de Código',
  roleCodeReviewerDesc: 'Revisa pull requests e qualidade de código',
  roleSoftwareEngineer: 'Engenheiro de Software',
  roleSoftwareEngineerDesc: 'Escreve e mantém código',
  roleTechnicalWriter: 'Redator Técnico',
  roleTechnicalWriterDesc: 'Cria documentação e guias',
  roleResearchAssistant: 'Assistente de Pesquisa',
  roleResearchAssistantDesc: 'Coleta e analisa informações',
  roleDataAnalyst: 'Analista de Dados',
  roleDataAnalystDesc: 'Explora e visualiza dados',
  roleUiUxDeveloper: 'Desenvolvedor UI/UX',
  roleUiUxDeveloperDesc: 'Projeta interfaces e componentes',
  roleProjectPlanner: 'Planejador de Projetos',
  roleProjectPlannerDesc: 'Planeja tarefas e marcos',
  roleTestEngineer: 'Engenheiro de Testes',
  roleTestEngineerDesc: 'Escreve e executa testes',
  roleSecurityAuditor: 'Auditor de Segurança',
  roleSecurityAuditorDesc: 'Analisa vulnerabilidades de segurança',
  roleDevOpsEngineer: 'Engenheiro DevOps',
  roleDevOpsEngineerDesc: 'Gerencia infraestrutura e CI/CD',

  // Profile Detail Page
  profileDetail: 'Detalhes do Perfil',
  backToProfiles: 'Voltar aos Perfis',
  unsavedChanges: 'Você tem alterações não salvas',
  discardChanges: 'Descartar Alterações',
  saving: 'Salvando...',
  changesSaved: 'Alterações salvas',
  profileNotFound: 'Perfil não encontrado',
  startFromScratch: 'Começar do zero',
  tabOverview: 'Visão Geral',
  tabTools: 'Ferramentas',
  systemPromptPreview: 'Prévia do Prompt do Sistema',
  systemPromptPreviewDesc: 'Este é o prompt renderizado que o LLM recebe.',
  refreshPreview: 'Atualizar',
  noSoulForPreview:
    'Configure uma alma para ver o prompt do sistema renderizado.',
  quickSetup: 'Configuração Rápida',
  quickSetupDesc:
    'Descreva seu agente em texto simples e nós o estruturaremos para você.',
  quickSetupPlaceholder:
    'Descreva a personalidade, especialização e comportamento do seu agente...',
  autoStructure: 'Auto-estruturar',
  autoStructuring: 'Estruturando...',
  autoStructureSuccess:
    'Alma estruturada com sucesso! Revise as abas para ajustar.',
  orChooseTemplate: 'Ou escolha um modelo',

  // Thinking config
  thinkingConfig: 'Pensamento',
  thinkingAdaptive: 'Adaptativo',
  thinkingEnabled: 'Orçamento fixo',
  thinkingDisabled: 'Desativado',
  thinkingEffort: 'Nível de esforço',
  thinkingBudget: 'Tokens de orçamento',
  thinkingNone: 'Padrão',
  effortLow: 'Baixo',
  effortMedium: 'Médio',
  effortHigh: 'Alto',
  effortXhigh: 'Extra alto',
  effortMax: 'Máximo',

  // Model descriptions
  modelBalanced: 'Equilibrado (padrão)',
  modelMostCapable: 'Mais capaz',
  modelFast: 'Rápido e leve',

  // Skills picker
  skillsAllAllowed: 'Permitir tudo',
  skillsRestrict: 'Restringir',
  skillsAllAllowedDesc:
    'Todas as habilidades, ferramentas e capacidades integradas estão disponíveis para este perfil. Clique em Restringir para selecionar habilidades específicas.',
  skillStaleRemove: 'Habilidade não mais disponível — clique para remover',
  skillsNoneInstalled:
    'Nenhuma habilidade instalada. Adicione habilidades em ~/.claude/skills/ para habilitá-las aqui.',
  maxConcurrentTasksDesc:
    'Quantidade máxima de tarefas que este perfil pode executar simultaneamente. Tarefas extras são enfileiradas e iniciam automaticamente quando uma vaga abre.',

  // Quickstart Wizard
  quickstartStepTemplate: 'Escolha uma especialidade',
  quickstartStepPersonalize: 'Personalize',
  quickstartStepConfigure: 'Configurar',
  quickstartStepConfirm: 'Pronto para começar',
  quickstartConfigureTitle: 'Configure seu agente',
  quickstartConfigureSubtitle: 'Defina o runtime, ferramentas e comportamento',
  quickstartWelcomeTitle: 'Escolha a especialidade do seu agente',
  quickstartWelcomeSubtitle:
    'Cada modelo inclui habilidades e personalidade — escolha um para começar',
  quickstartSkillsIncluded: '{count} habilidades incluídas',
  quickstartTemplateCustom: 'Personalizado',
  quickstartTemplateCustomDesc: 'Comece do zero e configure tudo você mesmo',
  quickstartSkipSetup: 'Pular — usar agente padrão',
  quickstartBack: 'Voltar',
  quickstartContinue: 'Continuar',
  quickstartDefaultName: 'Assistente geral',
  quickstartSkillSingular: 'habilidade',
  quickstartSkillPlural: 'habilidades',
  quickstartPersonalizeTitle: 'Personalize seu agente',
  quickstartPersonalizeSubtitle:
    'Ajuste o básico — você pode refinar tudo depois',
  quickstartGreetingPreview: 'Prévia da saudação',
  quickstartBundledSkills: 'Habilidades incluídas',
  quickstartSkipDetails: 'Usar padrões do modelo',
  quickstartConfirmTitle: 'Seu agente está pronto!',
  quickstartConfirmSummary:
    '{name} está configurado com {skillCount} habilidades e pronto para conversar',
  quickstartStartChatting: 'Começar a conversar',
  quickstartCustomizeFurther: 'Personalizar mais nas Configurações',

  // Soul Greeting
  soulGreeting: 'Saudação',
  soulGreetingDesc:
    'A primeira mensagem que seu agente envia em novas conversas.',
  soulGreetingPlaceholder:
    'ex., "Oi! Estou pronto para ajudar. Em que estamos trabalhando?"',

  // Skill Bundles
  soulSkillBundles: 'Pacotes de Habilidades',
  soulSkillBundlesDesc:
    'Fluxos de trabalho e metodologias pré-configurados nos quais este agente se especializa.',
  soulSkillName: 'Nome da habilidade',
  soulSkillDescription: 'Descrição',
  soulSkillApproach: 'Metodologia',
  soulSkillTrigger: 'Quando ativar',

  // Skill i18n
  skillCodeReview: 'Revisão de Código',
  skillCodeReviewDesc:
    'Revisão de código pré-merge para bugs, segurança e qualidade',
  skillInvestigate: 'Investigar',
  skillInvestigateDesc:
    'Depuração sistemática de causa raiz com metodologia de 4 fases',
  skillSecurityAudit: 'Auditoria de Segurança',
  skillSecurityAuditDesc:
    'OWASP Top 10, modelo de ameaças STRIDE, arqueologia de segredos',
  skillBrainstorm: 'Brainstorm',
  skillBrainstormDesc:
    'Ideação estruturada com perguntas direcionadas e design thinking',
  skillPlanReview: 'Revisão de Plano',
  skillPlanReviewDesc:
    'Revisão de engenharia: arquitetura, fluxo de dados, casos extremos, matriz de testes',
  skillShip: 'Enviar',
  skillShipDesc:
    'Fluxo completo de envio: testes, revisão, versão, changelog, PR',
  skillDocUpdate: 'Atualizar Docs',
  skillDocUpdateDesc:
    'Sincronização de documentação pós-envio em todos os docs do projeto',
  skillRetro: 'Retrospectiva',
  skillRetroDesc:
    'Retrospectiva semanal de engenharia com análise de commits e tendências',

  // Template names
  templateFullStackDev: 'Desenvolvedor Full-Stack',
  templateFullStackDevDesc:
    'Escreve, revisa, testa e depura código em toda a stack',
  templateCodeReviewer: 'Revisor de Código',
  templateCodeReviewerDesc:
    'Revisa código em busca de bugs, problemas de segurança e boas práticas',
  templateQaEngineer: 'Engenheiro QA',
  templateQaEngineerDesc:
    'Testes sistemáticos, busca de bugs e prevenção de regressões',
  templateProjectPlanner: 'Planejador de Projetos',
  templateProjectPlannerDesc:
    'Decompõe projetos em tarefas com estimativas e dependências',
  templateTechWriter: 'Redator Técnico',
  templateTechWriterDesc:
    'Cria documentação clara, referências de API e tutoriais',
  templateSecurityAuditor: 'Auditor de Segurança',
  templateSecurityAuditorDesc:
    'Varredura OWASP Top 10, modelagem de ameaças e detecção de segredos',
  templateResearchAnalyst: 'Analista de Pesquisa',
  templateResearchAnalystDesc:
    'Pesquisa profunda com citação de fontes e análise equilibrada',
  templateDataAnalyst: 'Analista de Dados',
  templateDataAnalystDesc:
    'Exploração de dados, visualização e insights acionáveis',
  templateCreativeWriter: 'Escritor Criativo',
  templateCreativeWriterDesc: 'Criação de conteúdo, edição e adaptação de tom',
  templateGeneralHelper: 'Assistente Geral',
  templateGeneralHelperDesc:
    'Assistente versátil para tarefas e perguntas do dia a dia',
};
