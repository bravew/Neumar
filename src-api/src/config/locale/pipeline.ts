/**
 * Pipeline i18n Messages
 *
 * Backend i18n for pipeline status comments (Linear, Slack)
 * and error messages. Follows frontend pattern: flat key-value maps per locale.
 */

export type PipelineLocale = 'en' | 'zh' | 'es' | 'fr' | 'hi' | 'pt';

export interface PipelineMessages {
  triaging: string;
  branchCreated: string;
  settingUpWorkspace: string;
  researching: string;
  implementing: string;
  awaitingApprovalWithScore: string;
  awaitingApproval: string;
  creatingPr: string;
  awaitingReviewWithUrl: string;
  awaitingReview: string;
  awaitingCi: string;
  completed: string;
  failed: string;
  approveInstructions: string;
  researchFound: string;
  pipelineStarted: string;
  pipelineFailed: string;
  prReady: string;
}

const en: PipelineMessages = {
  triaging: 'Triaging — classifying issue type and target repository.',
  branchCreated: 'Branch created: `{branch}`',
  settingUpWorkspace: 'Setting up workspace...',
  researching: 'Researching best practices for the tech stack...',
  implementing: 'Implementation in progress...',
  awaitingApprovalWithScore:
    'Plan ready (confidence: {confidence}/10). Reply **"approved"** to proceed or **"reject"** to cancel.',
  awaitingApproval: 'Plan ready for review. Reply **"approved"** to proceed.',
  creatingPr: 'Creating pull request...',
  awaitingReviewWithUrl: 'PR created: {prUrl} — waiting for review.',
  awaitingReview: 'PR created — waiting for review.',
  awaitingCi: 'Waiting for CI checks to complete...',
  completed: 'Pipeline completed successfully.',
  failed: 'Pipeline failed: {error}',
  approveInstructions:
    'Reply **"approved"** to proceed or **"reject"** to cancel.',
  researchFound: 'Found {count} best practices for {techStack}.',
  pipelineStarted: 'Pipeline started for {issueId}.',
  pipelineFailed: 'Pipeline failed for {issueId}: {error}',
  prReady: 'PR ready for review: {prUrl}',
};

const zh: PipelineMessages = {
  triaging: '正在分类 — 识别问题类型和目标仓库。',
  branchCreated: '分支已创建：`{branch}`',
  settingUpWorkspace: '正在设置工作区...',
  researching: '正在研究技术栈��最佳实践...',
  implementing: '正在实施中...',
  awaitingApprovalWithScore:
    '方案就绪（置信度：{confidence}/10）。回复 **"approved"** 继续，或 **"reject"** 取消。',
  awaitingApproval: '方案等待审核。回复 **"approved"** 继续。',
  creatingPr: '正在创建 Pull Request...',
  awaitingReviewWithUrl: 'PR 已创建：{prUrl} — 等待审核。',
  awaitingReview: 'PR 已创建 — 等待审核。',
  awaitingCi: '等待 CI 检查完成...',
  completed: '流水线已成功完成。',
  failed: '流水线失败：{error}',
  approveInstructions: '回复 **"approved"** 继续，或 **"reject"** 取消。',
  researchFound: '为 {techStack} 找到 {count} 条最佳实践。',
  pipelineStarted: '{issueId} 的流水线已启动。',
  pipelineFailed: '{issueId} 的流水线失败：{error}',
  prReady: 'PR 已就绪，等待审核：{prUrl}',
};

const es: PipelineMessages = {
  triaging: 'Clasificando — identificando tipo de issue y repositorio destino.',
  branchCreated: 'Rama creada: `{branch}`',
  settingUpWorkspace: 'Configurando espacio de trabajo...',
  researching: 'Investigando mejores prácticas para el stack tecnológico...',
  implementing: 'Implementación en progreso...',
  awaitingApprovalWithScore:
    'Plan listo (confianza: {confidence}/10). Responde **"approved"** para continuar o **"reject"** para cancelar.',
  awaitingApproval:
    'Plan listo para revisión. Responde **"approved"** para continuar.',
  creatingPr: 'Creando pull request...',
  awaitingReviewWithUrl: 'PR creado: {prUrl} — esperando revisión.',
  awaitingReview: 'PR creado — esperando revisión.',
  awaitingCi: 'Esperando que las verificaciones de CI terminen...',
  completed: 'Pipeline completado exitosamente.',
  failed: 'Pipeline falló: {error}',
  approveInstructions:
    'Responde **"approved"** para continuar o **"reject"** para cancelar.',
  researchFound: 'Se encontraron {count} mejores prácticas para {techStack}.',
  pipelineStarted: 'Pipeline iniciado para {issueId}.',
  pipelineFailed: 'Pipeline falló para {issueId}: {error}',
  prReady: 'PR listo para revisión: {prUrl}',
};

const fr: PipelineMessages = {
  triaging: "Tri en cours — classification du type d'issue et du dépôt cible.",
  branchCreated: 'Branche créée : `{branch}`',
  settingUpWorkspace: "Configuration de l'espace de travail...",
  researching: 'Recherche des meilleures pratiques pour la stack technique...',
  implementing: 'Implémentation en cours...',
  awaitingApprovalWithScore:
    'Plan prêt (confiance : {confidence}/10). Répondez **"approved"** pour continuer ou **"reject"** pour annuler.',
  awaitingApproval:
    'Plan prêt pour révision. Répondez **"approved"** pour continuer.',
  creatingPr: 'Création de la pull request...',
  awaitingReviewWithUrl: 'PR créée : {prUrl} — en attente de révision.',
  awaitingReview: 'PR créée — en attente de révision.',
  awaitingCi: 'En attente des vérifications CI...',
  completed: 'Pipeline terminé avec succès.',
  failed: 'Pipeline échoué : {error}',
  approveInstructions:
    'Répondez **"approved"** pour continuer ou **"reject"** pour annuler.',
  researchFound: '{count} meilleures pratiques trouvées pour {techStack}.',
  pipelineStarted: 'Pipeline démarré pour {issueId}.',
  pipelineFailed: 'Pipeline échoué pour {issueId} : {error}',
  prReady: 'PR prête pour révision : {prUrl}',
};

const hi: PipelineMessages = {
  triaging: 'वर्गीकरण — इश्यू प्रकार और लक्ष्य रिपॉजिटरी की पहचान कर रहे हैं।',
  branchCreated: 'ब���रांच बनाई गई: `{branch}`',
  settingUpWorkspace: 'क���र्यक्षेत्र सेट अप हो रहा है...',
  researching: 'तकनीकी स्टैक के लिए सर्वोत्तम प्रथाओं पर शोध कर रहे हैं...',
  implementing: 'कार्यान्वयन प्रगति पर है...',
  awaitingApprovalWithScore:
    'योजना तैयार (विश्वास: {confidence}/10)। जारी रखने के लिए **"approved"** या रद्द करने के लिए **"reject"** उत्तर दें।',
  awaitingApproval:
    'योजना समीक्षा के लिए तैयार। जारी रखने के लिए **"approved"** उत्तर दें।',
  creatingPr: 'पुल रिक्वेस्ट बना रहे हैं...',
  awaitingReviewWithUrl: 'PR बनाई गई: {prUrl} — समीक्षा की प्रतीक्षा में।',
  awaitingReview: 'PR बनाई गई — समीक्षा की प्रतीक्षा में।',
  awaitingCi: 'CI जांच पूरी होने की प्रतीक्षा में...',
  completed: 'पाइपलाइन सफलतापूर्वक पूरी हुई।',
  failed: 'पाइपलाइन विफल: {error}',
  approveInstructions:
    'जारी रखने के लिए **"approved"** या रद्द करने के लिए **"reject"** उत्तर दें।',
  researchFound: '{techStack} के लिए {count} सर्वोत्तम प्रथाएँ मिलीं।',
  pipelineStarted: '{issueId} के लिए पाइपलाइन शुरू हुई।',
  pipelineFailed: '{issueId} के लिए पाइपलाइन विफल: {error}',
  prReady: 'PR समीक्षा के लिए तैयार: {prUrl}',
};

const pt: PipelineMessages = {
  triaging: 'Triagem — classificando tipo de issue e repositório de destino.',
  branchCreated: 'Branch criada: `{branch}`',
  settingUpWorkspace: 'Configurando espaço de trabalho...',
  researching: 'Pesquisando melhores práticas para a stack tecnológica...',
  implementing: 'Implementação em progresso...',
  awaitingApprovalWithScore:
    'Plano pronto (confiança: {confidence}/10). Responda **"approved"** para continuar ou **"reject"** para cancelar.',
  awaitingApproval:
    'Plano pronto para revisão. Responda **"approved"** para continuar.',
  creatingPr: 'Criando pull request...',
  awaitingReviewWithUrl: 'PR criada: {prUrl} — aguardando revisão.',
  awaitingReview: 'PR criada — aguardando revisão.',
  awaitingCi: 'Aguardando verificações de CI...',
  completed: 'Pipeline concluído com sucesso.',
  failed: 'Pipeline falhou: {error}',
  approveInstructions:
    'Responda **"approved"** para continuar ou **"reject"** para cancelar.',
  researchFound: 'Encontradas {count} melhores práticas para {techStack}.',
  pipelineStarted: 'Pipeline iniciado para {issueId}.',
  pipelineFailed: 'Pipeline falhou para {issueId}: {error}',
  prReady: 'PR pronta para revisão: {prUrl}',
};

const LOCALES: Record<PipelineLocale, PipelineMessages> = {
  en,
  zh,
  es,
  fr,
  hi,
  pt,
};

/**
 * Get pipeline messages for a locale. Falls back to English.
 */
export function getPipelineMessages(
  locale?: PipelineLocale | string,
): PipelineMessages {
  if (!locale) return en;
  // Normalize: "en-US" -> "en", "zh-CN" -> "zh"
  const shortLocale = locale.split('-')[0]?.toLowerCase() as PipelineLocale;
  return LOCALES[shortLocale] ?? en;
}

/**
 * Simple template interpolation: replaces {key} placeholders in a message.
 */
export function formatMessage(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}
