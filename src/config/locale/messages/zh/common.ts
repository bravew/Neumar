export default {
  // 通用操作
  save: '保存',
  cancel: '取消',
  delete: '删除',
  edit: '编辑',
  confirm: '确认',
  reset: '重置',
  close: '关闭',
  more: '查看全部...',
  loading: '加载中...',
  noData: '暂无内容',
  search: '搜索',
  add: '添加',
  remove: '移除',
  yes: '是',
  no: '否',
  ok: '确定',
  back: '返回',
  next: '下一步',
  done: '完成',
  error: '错误',
  success: '成功',
  warning: '警告',
  info: '提示',

  // 展开/收起
  showMore: '展开更多',
  showLess: '收起',
  showMoreCount: '还有 {count} 项',

  // 通用操作
  dismiss: '关闭',
  refresh: '刷新',
  stop: '停止',

  // 滚动
  scrollToBottom: '滚动到底部',

  // 任务操作
  favorite: '收藏',
  unfavorite: '取消收藏',
  deleteTask: '删除任务',
  deleteTaskConfirm: '确定要删除这个任务吗？',
  deleteTaskDescription: '此操作无法撤销，任务中的所有消息和文件将被永久删除。',
  deleteSessionFolder: '同时删除会话文件夹',
  deleteSessionFolderDescription: '这将永久删除磁盘上会话文件夹中的所有文件。',
  sessionFolderPath: '会话文件夹：',
  viewFolder: '打开文件夹',
  renameTitle: '重命名',
  renameTitlePlaceholder: '输入新标题...',
  regenerateTitle: '重新生成标题',
  regeneratingTitle: '生成中...',

  // API 错误提示 — 友好、清晰、可操作
  errors: {
    connectionFailed: '正在连接，请稍候...',
    connectionFailedFinal: '无法连接到服务，请检查网络后重试。',
    corsError: '请求被浏览器阻止，请检查服务配置。',
    timeout: '请求超时，请稍后再试。',
    serverNotRunning: '智能体服务未启动，请先启动应用。',
    requestFailed: '出了点问题：{message}',
    retrying: '正在重试 ({attempt}/{max})...',
    internalError: '发生内部错误，详情请查看日志文件：{logPath}',
    customApiError:
      '自定义 API ({baseUrl}) 可能不兼容。请检查配置或尝试其他供应商。日志：{logPath}',
    openLogFile: '查看日志文件',
    modelNotConfigured:
      '尚未配置 AI 模型。请前往设置，配置 API 地址、密钥和模型名称后即可开始使用。',
    claudeCodeNotFound:
      'Claude Code 未安装或不可用。您可以在设置中配置自定义 AI 模型，或运行 npm install -g @anthropic-ai/claude-code 安装。',
    configureModel: '配置模型',
    apiKeyError:
      'AI 模型请求失败，请在设置中检查 API 地址、密钥和模型名称是否正确。',
    configureApiKey: '打开设置',
    agentProcessError: '智能体遇到问题，请检查模型配置后重试。',
    contextOverflow:
      '模型 {model} 的上下文窗口已达到上限。对话内容太长，无法处理。',
    contextOverflowNewSession: '开始新会话',
    contextOverflowSwitchModel: '切换模型',
  },

  // 问题输入 — 智能体向用户提问时
  questionInput: {
    needsInput: '需要您的输入',
    submit: '提交',
    other: '其他',
    customInput: '自定义回复',
    placeholder: '请输入您的回答...',
  },

  // 反馈对话框
  feedback: {
    title: '发送反馈',
    description: '分享您的想法、报告问题或请求新功能，帮助我们改进产品。',
    categoryLabel: '类别',
    categoryBugReport: '问题报告',
    categoryFeatureRequest: '功能请求',
    categoryGeneralFeedback: '一般反馈',
    categoryQuestion: '问题咨询',
    subjectLabel: '主题',
    subjectPlaceholder: '简要描述您的反馈',
    descriptionLabel: '详细描述',
    descriptionPlaceholderBug:
      '发生了什么？您预期的结果是什么？如何重现该问题...',
    descriptionPlaceholderFeature: '描述您希望拥有的功能以及它为什么有用...',
    descriptionPlaceholderFeedback: '分享您的想法、建议或使用体验...',
    descriptionPlaceholderQuestion: '您想了解什么？请尽可能具体地描述...',
    emailLabel: '邮箱（可选）',
    emailPlaceholder: 'your@email.com — 以便我们跟进',
    submit: '提交反馈',
    submitting: '提交中...',
    successTitle: '感谢您！',
    successMessage: '您的反馈已提交。我们非常感谢您的意见！',
    errorMessage: '提交反馈失败，请重试。',
    sendAnother: '再次反馈',
    menuLabel: '发送反馈',
  },

  // 链接安全弹窗
  linkSafety: {
    openExternalLink: '打开外部链接？',
    externalLinkWarning: '您即将访问一个外部网站。',
    copyLink: '复制链接',
    copied: '已复制',
    openLink: '打开链接',
  },
};
