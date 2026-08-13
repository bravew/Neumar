export default {
  title: 'Agent Profiles',
  createProfile: 'Create Profile',
  editProfile: 'Edit Profile',
  deleteProfile: 'Delete Profile',
  name: 'Name',
  role: 'Role',
  description: 'Description',
  runtime: 'Runtime',
  model: 'Model',
  status: 'Status',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  systemPrompt: 'System Prompt',
  noProfiles: 'No profiles yet',
  confirmDelete: 'Are you sure you want to delete this profile?',
  cannotDeleteRunning: 'Cannot delete profile with running tasks',
  selectRuntime: 'Select runtime...',
  mcpServers: 'MCP Servers',
  skills: 'Skills',
  maxConcurrentTasks: 'Max Concurrent Tasks',
  taskCount: '{count} tasks',
  noTasks: 'No tasks',
  assignedAgent: 'Assigned Agent',
  noAgent: 'No agent',
  unavailable: '(unavailable)',
  all: 'All',
  newAgent: 'New Agent',
  newTask: 'New Task',
  noProfilesForFilter: 'No agents match this filter.',
  advanced: 'Advanced',

  // Soul Editor
  soulEditor: 'Soul Editor',
  editSoul: 'Edit Soul',
  chooseSoulTemplate: 'Choose Template',
  soulVersion: 'Soul v{version}',
  soulManagedPrompt: 'System prompt managed by Soul Editor',

  // Soul Tabs
  soulIdentity: 'Identity',
  soulVoice: 'Voice',
  soulCognition: 'Cognition',
  soulBoundaries: 'Boundaries',
  soulEvolution: 'Evolution',

  // Identity
  soulRole: 'Role',
  soulRoleDesc: 'The primary role or persona this agent embodies.',
  soulCoreValues: 'Core Values',
  soulCoreValuesDesc:
    'Guiding principles that shape behavior and decision-making.',
  soulCoreValuesPlaceholder: 'Add a core value...',
  soulWorldview: 'Worldview',
  soulWorldviewPlaceholder: 'Describe how this agent sees the world...',
  soulOpinions: 'Opinions',
  soulOpinionsDesc: 'Strong stances or beliefs the agent holds.',
  soulOpinionsPlaceholder: 'Add an opinion...',

  // Voice
  soulTone: 'Tone',
  soulToneDesc: 'The overall tone of communication.',
  soulTonePlaceholder: 'e.g. Professional yet approachable',
  soulStyleRules: 'Style Rules',
  soulStyleRulesDesc: 'Specific rules that govern writing style.',
  soulStyleRulesPlaceholder: 'Add a style rule...',
  soulExamplePhrases: 'Example Phrases',
  soulExamplePhrasesDesc: 'Typical phrases this agent would use.',
  soulExamplePhrasesPlaceholder: 'Add an example phrase...',
  soulAntiPatterns: 'Anti-Patterns',
  soulAntiPatternsDesc: 'Phrases or patterns this agent should never use.',
  soulAntiPatternsPlaceholder: 'Add an anti-pattern...',

  // Cognition
  soulReasoningStyle: 'Reasoning Style',
  soulReasoningStylePlaceholder:
    'Describe how this agent reasons and approaches problems...',
  soulExpertise: 'Expertise',
  soulExpertiseDesc: 'Areas of deep knowledge this agent specializes in.',
  soulExpertisePlaceholder: 'Type expertise area and press Enter...',
  soulOperatingModes: 'Operating Modes',
  soulOperatingModesDesc: 'Named modes with distinct behaviors.',
  soulModeName: 'Mode name',
  soulModeDescription: 'Behavior description',
  soulApproachPrefs: 'Approach Preferences',
  soulApproachPrefsDesc: 'Preferred methods or strategies when tackling tasks.',
  soulApproachPrefsPlaceholder: 'Add a preference...',

  // Boundaries
  soulRedLines: 'Red Lines',
  soulRedLinesDesc: 'Absolute boundaries that must never be crossed.',
  soulRedLinesPlaceholder: 'Add a hard boundary...',
  soulRequired: 'Required',
  soulEscalation: 'Escalation Rules',
  soulEscalationDesc: 'When and how to escalate issues to a human.',
  soulEscalationPlaceholder: 'Add an escalation rule...',
  soulPrivacy: 'Privacy Rules',
  soulPrivacyDesc: 'Rules about handling sensitive or personal data.',
  soulPrivacyPlaceholder: 'Add a privacy rule...',
  soulActionLimits: 'Action Limits',
  soulActionLimitsDesc: 'Constraints on what actions the agent can take.',
  soulActionLimitsPlaceholder: 'Add an action limit...',

  // Evolution
  soulSelfImproving: 'Self-Improving Mode',
  soulSelfImprovingDesc:
    'When enabled, the agent learns from mistakes and accumulates knowledge over time.',
  soulMaxCorrections: 'Max Corrections',
  soulMaxLearnings: 'Max Learnings',
  soulLastEvolved: 'Last evolved: {date}',
  soulCorrections: 'Corrections',
  soulLearnings: 'Learnings',
  soulNoCorrections: 'No corrections recorded yet.',
  soulNoLearnings: 'No learnings recorded yet.',
  soulCorrectionIssue: 'Issue: ',
  soulCorrectionFix: 'Fix: ',

  // Default soul values
  soulDefaultValue: 'Helpful',
  soulDefaultStyleRule: 'Be clear and concise',
  soulDefaultRedLine: 'Never fabricate information',

  // Shared UI
  soulAdd: 'Add',
  soulRemove: 'Remove',
  soulAddItem: 'Add item...',
  soulTypeAndEnter: 'Type and press Enter...',

  // Templates
  soulTemplates: 'Soul Templates',
  soulApplyTemplate: 'Apply Template',
  soulExport: 'Export Soul',
  soulImport: 'Import Soul',

  // Role presets
  roleCodeReviewer: 'Code Reviewer',
  roleCodeReviewerDesc: 'Reviews pull requests and code quality',
  roleSoftwareEngineer: 'Software Engineer',
  roleSoftwareEngineerDesc: 'Writes and maintains code',
  roleTechnicalWriter: 'Technical Writer',
  roleTechnicalWriterDesc: 'Creates documentation and guides',
  roleResearchAssistant: 'Research Assistant',
  roleResearchAssistantDesc: 'Gathers and analyzes information',
  roleDataAnalyst: 'Data Analyst',
  roleDataAnalystDesc: 'Explores and visualizes data',
  roleUiUxDeveloper: 'UI/UX Developer',
  roleUiUxDeveloperDesc: 'Designs interfaces and components',
  roleProjectPlanner: 'Project Planner',
  roleProjectPlannerDesc: 'Plans tasks and milestones',
  roleTestEngineer: 'Test Engineer',
  roleTestEngineerDesc: 'Writes and runs tests',
  roleSecurityAuditor: 'Security Auditor',
  roleSecurityAuditorDesc: 'Analyzes security vulnerabilities',
  roleDevOpsEngineer: 'DevOps Engineer',
  roleDevOpsEngineerDesc: 'Manages infrastructure and CI/CD',

  // Profile Detail Page
  profileDetail: 'Profile Details',
  backToProfiles: 'Back to Profiles',
  unsavedChanges: 'You have unsaved changes',
  discardChanges: 'Discard Changes',
  saving: 'Saving...',
  changesSaved: 'Changes saved',
  profileNotFound: 'Profile not found',
  startFromScratch: 'Start from scratch',

  // Page tabs
  tabOverview: 'Overview',
  tabTools: 'Tools',

  // System prompt preview
  systemPromptPreview: 'System Prompt Preview',
  systemPromptPreviewDesc: 'This is the rendered prompt that the LLM receives.',
  refreshPreview: 'Refresh',
  noSoulForPreview: 'Configure a soul to see the rendered system prompt.',

  // Quick setup
  quickSetup: 'Quick Setup',
  quickSetupDesc:
    'Describe your agent in plain text and we will structure it for you.',
  quickSetupPlaceholder:
    "Describe your agent's personality, expertise, and behavior...",
  autoStructure: 'Auto-structure',
  autoStructuring: 'Structuring...',
  autoStructureSuccess:
    'Soul structured successfully! Review the tabs to fine-tune.',
  orChooseTemplate: 'Or choose a template',

  // Quickstart Wizard
  quickstartStepTemplate: 'Choose a specialty',
  quickstartStepPersonalize: 'Make it yours',
  quickstartStepConfigure: 'Configure',
  quickstartStepConfirm: 'Ready to go',
  quickstartConfigureTitle: 'Configure your agent',
  quickstartConfigureSubtitle: 'Set up the runtime, tools, and behavior',
  quickstartWelcomeTitle: "Choose your agent's specialty",
  quickstartWelcomeSubtitle:
    'Each template comes with skills and personality — pick one to get started',
  quickstartSkillsIncluded: '{count} skills included',
  quickstartTemplateCustom: 'Custom',
  quickstartTemplateCustomDesc:
    'Start from scratch and configure everything yourself',
  quickstartSkipSetup: 'Skip — use default agent',
  quickstartBack: 'Back',
  quickstartContinue: 'Continue',
  quickstartDefaultName: 'General Helper',
  quickstartSkillSingular: 'skill',
  quickstartSkillPlural: 'skills',
  quickstartPersonalizeTitle: 'Personalize your agent',
  quickstartPersonalizeSubtitle:
    'Tweak the basics — you can fine-tune everything later',
  quickstartGreetingPreview: 'Greeting preview',
  quickstartBundledSkills: 'Bundled skills',
  quickstartSkipDetails: 'Use template defaults',
  quickstartConfirmTitle: 'Your agent is ready!',
  quickstartConfirmSummary:
    '{name} is set up with {skillCount} skills and ready to chat',
  quickstartStartChatting: 'Start chatting',
  quickstartCustomizeFurther: 'Customize further in Settings',

  // Soul Greeting (voice tab addition)
  soulGreeting: 'Greeting',
  soulGreetingDesc: 'The first message your agent sends in new conversations.',
  soulGreetingPlaceholder:
    'e.g., "Hi! I\'m ready to help. What are we working on?"',

  // Skill Bundles (cognition tab addition)
  soulSkillBundles: 'Skill Bundles',
  soulSkillBundlesDesc:
    'Pre-configured workflows and methodologies this agent specializes in.',
  soulSkillName: 'Skill name',
  soulSkillDescription: 'Description',
  soulSkillApproach: 'Methodology',
  soulSkillTrigger: 'When to activate',

  // Skill i18n (prepacked skills)
  skillCodeReview: 'Code Review',
  skillCodeReviewDesc:
    'Pre-landing code review for bugs, security, and quality',
  skillInvestigate: 'Investigate',
  skillInvestigateDesc:
    'Systematic root-cause debugging with 4-phase methodology',
  skillSecurityAudit: 'Security Audit',
  skillSecurityAuditDesc:
    'OWASP Top 10, STRIDE threat model, secrets archaeology',
  skillBrainstorm: 'Brainstorm',
  skillBrainstormDesc:
    'Structured ideation with forcing questions and design thinking',
  skillPlanReview: 'Plan Review',
  skillPlanReviewDesc:
    'Engineering review: architecture, data flow, edge cases, test matrix',
  skillShip: 'Ship',
  skillShipDesc: 'Full shipping workflow: test, review, version, changelog, PR',
  skillDocUpdate: 'Doc Update',
  skillDocUpdateDesc: 'Post-ship documentation sync across all project docs',
  skillRetro: 'Retrospective',
  skillRetroDesc:
    'Weekly engineering retrospective with commit analysis and trends',

  // Quickstart template names
  templateFullStackDev: 'Full-Stack Developer',
  templateFullStackDevDesc:
    'Writes, reviews, tests, and debugs code across the stack',
  templateCodeReviewer: 'Code Reviewer',
  templateCodeReviewerDesc:
    'Reviews code for bugs, security issues, and best practices',
  templateQaEngineer: 'QA Engineer',
  templateQaEngineerDesc:
    'Systematic testing, bug finding, and regression prevention',
  templateProjectPlanner: 'Project Planner',
  templateProjectPlannerDesc:
    'Breaks down projects into tasks with estimates and dependencies',
  templateTechWriter: 'Technical Writer',
  templateTechWriterDesc:
    'Creates clear documentation, API references, and tutorials',
  templateSecurityAuditor: 'Security Auditor',
  templateSecurityAuditorDesc:
    'OWASP Top 10 scanning, threat modeling, and secrets detection',
  templateResearchAnalyst: 'Research Analyst',
  templateResearchAnalystDesc:
    'Deep research with source-citing and balanced analysis',
  templateDataAnalyst: 'Data Analyst',
  templateDataAnalystDesc:
    'Data exploration, visualization, and actionable insights',
  templateCreativeWriter: 'Creative Writer',
  templateCreativeWriterDesc: 'Content creation, editing, and tone adaptation',
  templateGeneralHelper: 'General Helper',
  templateGeneralHelperDesc:
    'Versatile assistant for everyday tasks and questions',

  // Thinking config
  thinkingConfig: 'Thinking',
  thinkingAdaptive: 'Adaptive',
  thinkingEnabled: 'Fixed Budget',
  thinkingDisabled: 'Disabled',
  thinkingEffort: 'Effort Level',
  thinkingBudget: 'Budget Tokens',
  thinkingNone: 'Default',
  effortLow: 'Low',
  effortMedium: 'Medium',
  effortHigh: 'High',
  effortXhigh: 'Extra high',
  effortMax: 'Max',

  // Model descriptions
  modelBalanced: 'Balanced (default)',
  modelMostCapable: 'Most capable',
  modelFast: 'Fast & lightweight',

  // Skills picker
  skillsAllAllowed: 'All Allowed',
  skillsRestrict: 'Restrict',
  skillsAllAllowedDesc:
    'All skills, tools, and built-in capabilities are available to this profile. Click Restrict to select specific skills.',
  skillStaleRemove: 'Skill no longer available — click to remove',
  skillsNoneInstalled:
    'No skills installed. Add skills to ~/.claude/skills/ to enable them here.',
  maxConcurrentTasksDesc:
    'How many tasks this profile can run at the same time. Extra tasks are queued and start automatically when a slot opens.',
};
