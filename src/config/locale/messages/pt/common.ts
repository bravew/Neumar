export default {
  // Common actions
  save: 'Salvar',
  cancel: 'Cancelar',
  delete: 'Excluir',
  edit: 'Editar',
  confirm: 'Confirmar',
  reset: 'Redefinir',
  close: 'Fechar',
  more: 'Ver tudo...',
  loading: 'Carregando...',
  noData: 'Nada aqui ainda',
  search: 'Pesquisar',
  add: 'Adicionar',
  remove: 'Remover',
  yes: 'Sim',
  no: 'Não',
  ok: 'OK',
  back: 'Voltar',
  next: 'Próximo',
  done: 'Concluído',
  error: 'Erro',
  success: 'Sucesso',
  warning: 'Aviso',
  info: 'Informação',

  // Expandable content
  showMore: 'Mostrar mais',
  showLess: 'Mostrar menos',
  showMoreCount: 'mais {count}',

  // Ações genéricas
  dismiss: 'Dispensar',
  refresh: 'Atualizar',
  stop: 'Parar',

  // Scroll
  scrollToBottom: 'Rolar para o final',

  // Task actions
  favorite: 'Adicionar aos favoritos',
  unfavorite: 'Remover dos favoritos',
  deleteTask: 'Excluir tarefa',
  deleteTaskConfirm: 'Excluir esta tarefa?',
  deleteTaskDescription:
    'Esta ação não pode ser desfeita. Todas as mensagens e arquivos desta tarefa serão removidos permanentemente.',
  deleteSessionFolder: 'Excluir também a pasta da sessão',
  deleteSessionFolderDescription:
    'Isso excluirá permanentemente todos os arquivos na pasta da sessão do seu disco.',
  sessionFolderPath: 'Pasta da sessão:',
  viewFolder: 'Abrir pasta',
  renameTitle: 'Renomear',
  renameTitlePlaceholder: 'Insira um novo título...',
  regenerateTitle: 'Regenerar título',
  regeneratingTitle: 'Gerando...',

  // API error messages — friendly, helpful, and actionable
  errors: {
    connectionFailed: 'Conectando — aguarde...',
    connectionFailedFinal:
      'Não foi possível acessar o serviço. Verifique sua conexão de rede e tente novamente.',
    corsError:
      'A requisição foi bloqueada pelo seu navegador. Verifique a configuração do serviço.',
    timeout: 'A requisição demorou muito. Por favor, tente novamente.',
    serverNotRunning:
      'O serviço do agente não está em execução. Inicie o aplicativo primeiro.',
    requestFailed: 'Algo deu errado: {message}',
    retrying: 'Tentando novamente ({attempt}/{max})...',
    internalError:
      'Ocorreu um erro interno. Verifique o arquivo de log para detalhes: {logPath}',
    customApiError:
      'A API personalizada em {baseUrl} pode não ser compatível. Verifique a configuração ou tente um provedor diferente. Log: {logPath}',
    openLogFile: 'Ver Arquivo de Log',
    modelNotConfigured:
      'Nenhum modelo de IA configurado ainda. Vá em Configurações para definir seu endpoint de API, chave e modelo antes de começar.',
    claudeCodeNotFound:
      'Claude Code não está instalado ou indisponível. Você pode configurar um modelo de IA personalizado nas Configurações, ou instalar o Claude Code com: npm install -g @anthropic-ai/claude-code',
    configureModel: 'Configurar Modelo',
    apiKeyError:
      'A requisição do modelo de IA falhou. Verifique sua URL de API, chave e nome do modelo nas Configurações.',
    configureApiKey: 'Abrir Configurações',
    agentProcessError:
      'O agente encontrou um problema. Verifique a configuração do modelo e tente novamente.',
    contextOverflow:
      'Limite da janela de contexto atingido para {model}. A conversa é longa demais para este modelo processar.',
    contextOverflowNewSession: 'Nova Sessão',
    contextOverflowSwitchModel: 'Trocar Modelo',
  },

  // Question input — when the agent asks the user
  questionInput: {
    needsInput: 'Sua resposta é necessária',
    submit: 'Enviar',
    other: 'Outro',
    customInput: 'Resposta personalizada',
    placeholder: 'Digite sua resposta...',
  },

  // Feedback dialog
  feedback: {
    title: 'Enviar Feedback',
    description:
      'Ajude-nos a melhorar compartilhando suas ideias, relatando problemas ou solicitando funcionalidades.',
    categoryLabel: 'Categoria',
    categoryBugReport: 'Relatório de Bug',
    categoryFeatureRequest: 'Solicitação de Funcionalidade',
    categoryGeneralFeedback: 'Feedback Geral',
    categoryQuestion: 'Pergunta',
    subjectLabel: 'Assunto',
    subjectPlaceholder: 'Breve resumo do seu feedback',
    descriptionLabel: 'Descrição',
    descriptionPlaceholderBug:
      'O que aconteceu? O que você esperava? Passos para reproduzir...',
    descriptionPlaceholderFeature:
      'Descreva a funcionalidade que você gostaria e por que seria útil...',
    descriptionPlaceholderFeedback:
      'Compartilhe seus pensamentos, sugestões ou experiência...',
    descriptionPlaceholderQuestion:
      'O que você gostaria de saber? Seja o mais específico possível...',
    emailLabel: 'Email (opcional)',
    emailPlaceholder: 'seu@email.com — para que possamos responder',
    submit: 'Enviar Feedback',
    submitting: 'Enviando...',
    successTitle: 'Obrigado!',
    successMessage: 'Seu feedback foi enviado. Agradecemos sua contribuição!',
    errorMessage: 'Falha ao enviar feedback. Por favor, tente novamente.',
    sendAnother: 'Enviar Outro',
    menuLabel: 'Enviar Feedback',
  },

  // Modal de segurança de links
  linkSafety: {
    openExternalLink: 'Abrir link externo?',
    externalLinkWarning: 'Você está prestes a visitar um site externo.',
    copyLink: 'Copiar link',
    copied: 'Copiado',
    openLink: 'Abrir link',
  },
};
