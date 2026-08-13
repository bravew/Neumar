export default {
  save: 'Enregistrer',
  cancel: 'Annuler',
  delete: 'Supprimer',
  edit: 'Modifier',
  confirm: 'Confirmer',
  reset: 'Réinitialiser',
  close: 'Fermer',
  more: 'Tout voir...',
  loading: 'Chargement...',
  noData: 'Rien ici pour le moment',
  search: 'Rechercher',
  add: 'Ajouter',
  remove: 'Retirer',
  yes: 'Oui',
  no: 'Non',
  ok: 'OK',
  back: 'Retour',
  next: 'Suivant',
  done: 'Terminé',
  error: 'Erreur',
  success: 'Succès',
  warning: 'Avertissement',
  info: 'Info',
  showMore: 'Afficher plus',
  showLess: 'Afficher moins',
  showMoreCount: '{count} de plus',

  // Actions génériques
  dismiss: 'Fermer',
  refresh: 'Actualiser',
  stop: 'Arrêter',

  // Défilement
  scrollToBottom: 'Aller en bas',

  // Actions de tâche
  favorite: 'Ajouter aux favoris',
  unfavorite: 'Retirer des favoris',
  deleteTask: 'Supprimer la tâche',
  deleteTaskConfirm: 'Supprimer cette tâche ?',
  deleteTaskDescription:
    'Cette action est irréversible. Tous les messages et fichiers de cette tâche seront définitivement supprimés.',
  deleteSessionFolder: 'Supprimer également le dossier de session',
  deleteSessionFolderDescription:
    'Cela supprimera définitivement tous les fichiers du dossier de session sur le disque.',
  sessionFolderPath: 'Dossier de session :',
  viewFolder: 'Ouvrir le dossier',
  renameTitle: 'Renommer',
  renameTitlePlaceholder: 'Saisir un nouveau titre...',
  regenerateTitle: 'Régénérer le titre',
  regeneratingTitle: 'Génération...',

  // Messages d'erreur de l'API
  errors: {
    connectionFailed: 'Connexion en cours — un instant...',
    connectionFailedFinal:
      'Impossible de joindre le service. Vérifiez votre connexion et réessayez.',
    corsError: 'Requête bloquée. Vérifiez la configuration du service',
    timeout: "Délai d'attente dépassé. Veuillez réessayer",
    serverNotRunning:
      "Le service de l'agent n'est pas en cours d'exécution. Veuillez d'abord lancer l'application.",
    requestFailed: 'Un problème est survenu : {message}',
    retrying: 'Nouvelle tentative ({attempt}/{max})...',
    internalError:
      'Erreur interne du serveur. Consultez le fichier journal : {logPath}',
    customApiError:
      "L'API personnalisée ({baseUrl}) peut ne pas être compatible avec le SDK Claude Code. Vérifiez la configuration de l'API ou essayez un autre fournisseur. Fichier journal : {logPath}",
    openLogFile: 'Voir le fichier journal',
    modelNotConfigured:
      'Aucun modèle IA configuré. Rendez-vous dans les Paramètres pour configurer votre endpoint, clé et modèle.',
    claudeCodeNotFound:
      "Claude Code n'est pas installé ou n'est pas disponible. Veuillez configurer un modèle IA personnalisé dans les Paramètres, ou installer Claude Code (npm install -g @anthropic-ai/claude-code)",
    configureModel: 'Configurer le modèle',
    apiKeyError:
      "Échec de la requête au modèle IA. Vérifiez la configuration de votre modèle (URL de l'API, clé API, nom du modèle, etc.)",
    configureApiKey: 'Ouvrir les Paramètres',
    agentProcessError:
      "L'agent a rencontré un problème. Vérifiez la configuration de votre modèle et réessayez.",
    contextOverflow:
      'Limite de fenêtre de contexte atteinte pour {model}. La conversation est trop longue pour ce modèle.',
    contextOverflowNewSession: 'Nouvelle session',
    contextOverflowSwitchModel: 'Changer de modèle',
  },

  // Saisie de question
  questionInput: {
    needsInput: 'Votre réponse est nécessaire',
    submit: 'Envoyer',
    other: 'Autre',
    customInput: 'Réponse personnalisée',
    placeholder: 'Saisissez votre réponse...',
  },

  // Dialogue de retour d'information
  feedback: {
    title: 'Envoyer un retour',
    description:
      'Aidez-nous à nous améliorer en partageant vos idées, en signalant des problèmes ou en demandant des fonctionnalités.',
    categoryLabel: 'Catégorie',
    categoryBugReport: 'Rapport de bug',
    categoryFeatureRequest: 'Demande de fonctionnalité',
    categoryGeneralFeedback: 'Retour général',
    categoryQuestion: 'Question',
    subjectLabel: 'Sujet',
    subjectPlaceholder: 'Résumé bref de votre retour',
    descriptionLabel: 'Description',
    descriptionPlaceholderBug:
      "Que s'est-il passé ? Que vous attendiez-vous ? Étapes pour reproduire...",
    descriptionPlaceholderFeature:
      'Décrivez la fonctionnalité souhaitée et pourquoi elle serait utile...',
    descriptionPlaceholderFeedback:
      'Partagez vos idées, suggestions ou votre expérience...',
    descriptionPlaceholderQuestion:
      'Que souhaitez-vous savoir ? Soyez aussi précis que possible...',
    emailLabel: 'E-mail (facultatif)',
    emailPlaceholder:
      'votre@email.com — pour que nous puissions vous recontacter',
    submit: 'Envoyer le retour',
    submitting: 'Envoi en cours...',
    successTitle: 'Merci !',
    successMessage:
      'Votre retour a été envoyé. Nous apprécions votre contribution !',
    errorMessage: "Échec de l'envoi du retour. Veuillez réessayer.",
    sendAnother: 'Envoyer un autre',
    menuLabel: 'Envoyer un retour',
  },

  // Modale de sécurité des liens
  linkSafety: {
    openExternalLink: 'Ouvrir le lien externe ?',
    externalLinkWarning:
      'Vous êtes sur le point de visiter un site web externe.',
    copyLink: 'Copier le lien',
    copied: 'Copié',
    openLink: 'Ouvrir le lien',
  },
};
