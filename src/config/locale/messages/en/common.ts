export default {
  // Common actions
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  confirm: 'Confirm',
  reset: 'Reset',
  close: 'Close',
  more: 'View all...',
  loading: 'Loading...',
  noData: 'Nothing here yet',
  search: 'Search',
  add: 'Add',
  remove: 'Remove',
  yes: 'Yes',
  no: 'No',
  ok: 'OK',
  back: 'Back',
  next: 'Next',
  done: 'Done',
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  info: 'Info',

  // Expandable content
  showMore: 'Show more',
  showLess: 'Show less',
  showMoreCount: '{count} more',

  // Generic actions
  dismiss: 'Dismiss',
  refresh: 'Refresh',
  stop: 'Stop',

  // Scroll
  scrollToBottom: 'Scroll to bottom',

  // Task actions
  favorite: 'Add to favorites',
  unfavorite: 'Remove from favorites',
  deleteTask: 'Delete task',
  deleteTaskConfirm: 'Delete this task?',
  deleteTaskDescription:
    'This cannot be undone. All messages and files in this task will be permanently removed.',
  deleteSessionFolder: 'Also delete the session folder',
  deleteSessionFolderDescription:
    'This will permanently delete all files in the session folder from your disk.',
  sessionFolderPath: 'Session folder:',
  viewFolder: 'Open folder',
  renameTitle: 'Rename',
  renameTitlePlaceholder: 'Enter a new title...',
  regenerateTitle: 'Regenerate title',
  regeneratingTitle: 'Regenerating...',

  // API error messages — friendly, helpful, and actionable
  errors: {
    connectionFailed: 'Connecting — hang tight...',
    connectionFailedFinal:
      'Unable to reach the service. Please check your network and try again.',
    corsError:
      'The request was blocked by your browser. Please check the service configuration.',
    timeout: 'The request took too long. Please try again.',
    serverNotRunning:
      'The agent service is not running. Please launch the app first.',
    requestFailed: 'Something went wrong: {message}',
    retrying: 'Retrying ({attempt}/{max})...',
    internalError:
      'An internal error occurred. Check the log file for details: {logPath}',
    customApiError:
      'The custom API at {baseUrl} may not be compatible. Please verify the configuration or try a different provider. Log: {logPath}',
    openLogFile: 'View Log File',
    modelNotConfigured:
      'No AI model configured yet. Head to Settings to set up your API endpoint, key, and model before getting started.',
    claudeCodeNotFound:
      'Claude Code is not installed or unavailable. You can configure a custom AI model in Settings, or install Claude Code with: npm install -g @anthropic-ai/claude-code',
    configureModel: 'Configure Model',
    apiKeyError:
      'The AI model request failed. Please double-check your API URL, key, and model name in Settings.',
    configureApiKey: 'Open Settings',
    agentProcessError:
      'The agent ran into a problem. Please check your model configuration and try again.',
    contextOverflow:
      'Context window limit reached for {model}. The conversation is too long for this model to process.',
    contextOverflowNewSession: 'Start New Session',
    contextOverflowSwitchModel: 'Switch Model',
  },

  // Question input — when the agent asks the user
  questionInput: {
    needsInput: 'Your input is needed',
    submit: 'Submit',
    other: 'Other',
    customInput: 'Custom response',
    placeholder: 'Type your answer...',
  },

  // Feedback dialog
  feedback: {
    title: 'Send Feedback',
    description:
      'Help us improve by sharing your thoughts, reporting issues, or requesting features.',
    categoryLabel: 'Category',
    categoryBugReport: 'Bug Report',
    categoryFeatureRequest: 'Feature Request',
    categoryGeneralFeedback: 'General Feedback',
    categoryQuestion: 'Question',
    subjectLabel: 'Subject',
    subjectPlaceholder: 'Brief summary of your feedback',
    descriptionLabel: 'Description',
    descriptionPlaceholderBug:
      'What happened? What did you expect? Steps to reproduce...',
    descriptionPlaceholderFeature:
      'Describe the feature you would like and why it would be useful...',
    descriptionPlaceholderFeedback:
      'Share your thoughts, suggestions, or experience...',
    descriptionPlaceholderQuestion:
      'What would you like to know? Please be as specific as possible...',
    emailLabel: 'Email (optional)',
    emailPlaceholder: 'your@email.com — so we can follow up',
    submit: 'Submit Feedback',
    submitting: 'Submitting...',
    successTitle: 'Thank you!',
    successMessage:
      'Your feedback has been submitted. We appreciate your input!',
    errorMessage: 'Failed to submit feedback. Please try again.',
    sendAnother: 'Send Another',
    menuLabel: 'Send Feedback',
  },

  // Link safety modal
  linkSafety: {
    openExternalLink: 'Open external link?',
    externalLinkWarning: "You're about to visit an external website.",
    copyLink: 'Copy link',
    copied: 'Copied',
    openLink: 'Open link',
  },
};
