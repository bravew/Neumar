export default {
  inputPlaceholder: 'Décrivez ce dont vous avez besoin...',
  reply: 'Répondre...',
  replyWhileRunning: 'Ajouter du contexte...',
  welcomeTitle: 'Que puis-je vous aider à créer ?',
  welcomeSubtitle:
    "Votre agent IA pour le développement, la rédaction, l'analyse et le travail créatif — décrivez simplement ce dont vous avez besoin.",
  greeting: {
    morning: 'Bonjour, {name}',
    afternoon: 'Bonjour, {name}',
    evening: 'Bonsoir, {name}',
    neutral: 'Bonjour, {name}',
  },
  addFilesOrPhotos: 'Joindre des fichiers ou images',
  mcpServers: 'Serveurs MCP',
  mcpNoServersConfigured: 'Aucun serveur configuré',
  skills: 'Compétences',
  skillsSearch: 'Rechercher des compétences...',
  skillsNoSkillsFound: 'Aucune compétence trouvée',
  skillsMaxReached: 'Maximum de 3 compétences par message.',
  workInFolder: 'Travailler dans un dossier',
  selectedFolder: 'Dossier',
  removeFolder: 'Supprimer le dossier',

  // Dialogue de permissions de dossier
  folderPermission: {
    title: 'Autoriser {appName} à modifier les fichiers dans "{folderName}" ?',
    description:
      "Cela accorde l'accès en lecture, modification et suppression à tous les fichiers de ce dossier. Les outils de serveurs tiers peuvent également accéder à ces fichiers.",
    cancel: 'Annuler',
    alwaysAllow: 'Toujours autoriser',
    allow: 'Autoriser',
  },
  recentFolders: 'Récents',
  chooseDifferentFolder: 'Choisir un autre dossier',
  additionalFoldersCount: '+{count}',
  clearAllFolders: 'Tout effacer',
  noRecentFolders: 'Aucun dossier récent',

  quickActions: {
    createSlides: 'Créer des slides',
    createSlidesPrompt: 'Crée une présentation professionnelle pour moi',
    buildWebsite: 'Créer un site web',
    buildWebsitePrompt: 'Crée un site web moderne pour moi',
    developApps: 'Créer une app',
    developAppsPrompt: 'Développe une nouvelle application pour moi',
    design: 'Designer une UI',
    designPrompt: 'Conçois une interface utilisateur pour moi',
    more: 'Plus',
  },

  // Catégories d'actions rapides
  quickActionCategories: {
    write: {
      label: 'Écrire',
      items: {
        draftEmail: {
          label: 'Rédiger un e-mail',
          prompt:
            "Agis comme un rédacteur professionnel d'e-mails. J'ai besoin de rédiger un e-mail. Avant d'écrire, demande-moi :\n1. Qui est le destinataire et quelle est notre relation ?\n2. Quel est l'objectif de cet e-mail ?\n3. Quel ton doit-il avoir (formel, amical, persuasif) ?\n4. Y a-t-il des points clés ou des délais à mentionner ?\nPuis rédige l'e-mail avec un objet clair, une salutation, un corps et une signature.",
        },
        writeDocs: {
          label: 'Écrire de la documentation',
          prompt:
            'Agis comme un rédacteur technique. Aide-moi à créer une documentation claire et bien structurée. Demande-moi :\n1. Que suis-je en train de documenter (API, fonctionnalité, processus, intégration) ?\n2. Qui est le public cible (développeurs, utilisateurs finaux, parties prenantes) ?\n3. Quel format convient le mieux (README, wiki, guide, référence) ?\nPuis produis une documentation avec des en-têtes appropriés, des exemples de code et un flux logique.',
        },
        editText: {
          label: 'Éditer et améliorer un texte',
          prompt:
            "Agis comme un éditeur expert. Je vais partager un texte à améliorer. Avant d'éditer, demande-moi :\n1. À quoi sert ce texte (blog, rapport, proposition, réseaux sociaux) ?\n2. Sur quels aspects dois-je me concentrer (clarté, ton, grammaire, concision) ?\n3. Dois-je préserver la voix originale ou réécrire librement ?\nPuis fournis la version améliorée avec les modifications suivies et explique les améliorations clés.",
        },
        writeBlog: {
          label: 'Écrire un article de blog',
          prompt:
            "Agis comme stratège de contenu et rédacteur. Aide-moi à écrire un article de blog captivant. Demande-moi :\n1. Quel est le sujet et mon angle unique ?\n2. Qui est le public cible ?\n3. Quelle longueur et quel ton (éducatif, conversationnel, leadership d'opinion) ?\n4. Doit-il inclure un appel à l'action ?\nPropose d'abord la structure de l'article, puis écris-le avec une accroche engageante, des sections claires et une conclusion forte.",
        },
        narrateText: {
          label: 'Convertir du texte en voix',
          prompt:
            "Aide-moi à convertir du texte en audio vocal naturel. Je veux créer une voix off ou une narration. Demande-moi :\n1. Quel texte doit être narré ?\n2. Quel ton et style (calme, énergique, professionnel, narratif) ?\n3. Dans quelle langue ?\n4. Où sera-t-il utilisé (podcast, présentation, vidéo) ?\nPuis utilise l'outil de synthèse vocale pour générer le fichier audio avec la voix la plus adaptée.",
        },
      },
    },
    code: {
      label: 'Coder',
      items: {
        buildFeature: {
          label: 'Créer une fonctionnalité',
          prompt:
            "Agis comme un développeur full-stack senior. Aide-moi à construire une nouvelle fonctionnalité de zéro. Demande-moi :\n1. Quel est le projet et sa stack technique ?\n2. Que doit faire cette fonctionnalité (user story ou exigences) ?\n3. Y a-t-il des patterns, APIs ou contraintes existants à respecter ?\n4. Quelle est la priorité — prototype fonctionnel ou code prêt pour la production ?\nPlanifie d'abord l'implémentation (structure de fichiers, composants clés, flux de données) avant d'écrire le code.",
        },
        debugIssue: {
          label: 'Déboguer un problème',
          prompt:
            "Agis comme un expert en débogage. Aide-moi à trouver et corriger un bug de manière systématique. Demande-moi :\n1. Quel est le comportement attendu vs. ce qui se passe réellement ?\n2. Quand cela a-t-il commencé (après un déploiement, un changement de code, une mise à jour de dépendance) ?\n3. Quels messages d'erreur, logs ou stack traces je vois ?\n4. Qu'ai-je déjà essayé ?\nGuide-moi dans un diagnostic structuré : reproduire → isoler → identifier la cause racine → corriger → vérifier.",
        },
        refactorCode: {
          label: 'Refactoriser du code',
          prompt:
            "Agis comme un expert en qualité de code. Aide-moi à refactoriser du code pour une meilleure maintenabilité. Demande-moi :\n1. Quel code doit être refactorisé (partage le fichier ou décris-le) ?\n2. Quels sont les principaux problèmes (duplication, complexité, nommage, structure) ?\n3. Y a-t-il des contraintes (rétrocompatibilité, couverture de tests, conventions d'équipe) ?\nSuggère des améliorations spécifiques avec des exemples avant/après, en expliquant le raisonnement de chaque changement.",
        },
        writeTests: {
          label: 'Écrire des tests',
          prompt:
            "Agis comme un ingénieur QA. Aide-moi à écrire des tests complets. Demande-moi :\n1. Quel code ou fonctionnalité est-ce que je teste ?\n2. Quel framework de test j'utilise (Jest, Vitest, Pytest, etc.) ?\n3. Quels types de tests sont nécessaires (unitaires, intégration, e2e) ?\n4. Y a-t-il des cas limites ou scénarios d'échec à couvrir ?\nÉcris des tests bien organisés avec des noms descriptifs, un setup/teardown approprié et des assertions significatives.",
        },
        automateWeb: {
          label: 'Automatiser une tâche web',
          prompt:
            "Aide-moi à automatiser une tâche de navigateur web. Je peux naviguer sur des pages, remplir des formulaires, cliquer sur des boutons, extraire des données et prendre des captures d'écran. Demande-moi :\n1. Quel site web ou application web dois-je utiliser ?\n2. Quel est l'objectif (remplir un formulaire, extraire des données, tester un flux, captures d'écran) ?\n3. Cela nécessite-t-il une connexion ou une authentification ?\n4. Les résultats doivent-ils être sauvegardés dans un fichier ?\nConstruis l'automatisation étape par étape : naviguer → capturer → interagir → vérifier.",
        },
      },
    },
    analyze: {
      label: 'Analyser',
      items: {
        analyzeData: {
          label: 'Analyser des données',
          prompt:
            "Agis comme un analyste de données. Aide-moi à analyser un jeu de données et en extraire des informations. Demande-moi :\n1. Quel est le jeu de données (CSV, tableur, base de données ou colle les données) ?\n2. Quelles questions j'essaie de répondre ?\n3. Quel type d'analyse est nécessaire (tendances, corrélations, valeurs aberrantes, segmentation) ?\n4. Comment les résultats doivent-ils être présentés (graphiques, tableaux, rapport résumé) ?\nEffectue l'analyse étape par étape, explique chaque découverte clairement et mets en évidence les informations exploitables.",
        },
        researchTopic: {
          label: 'Rechercher un sujet',
          prompt:
            "Agis comme un analyste de recherche. Aide-moi à mener une recherche approfondie sur un sujet. Demande-moi :\n1. Quel sujet est-ce que je recherche ?\n2. Quel est l'objectif (prise de décision, rapport, apprentissage, analyse concurrentielle) ?\n3. Quelle profondeur ai-je besoin (aperçu, analyse approfondie, niveau expert) ?\n4. Y a-t-il des sources ou perspectives spécifiques à inclure ?\nOrganise les résultats en sections claires avec des conclusions clés, des preuves et des sources.",
        },
        compareOptions: {
          label: 'Comparer des options',
          prompt:
            "Agis comme un analyste décisionnel. Aide-moi à comparer des options et faire un choix éclairé. Demande-moi :\n1. Qu'est-ce que je compare (outils, frameworks, fournisseurs, stratégies) ?\n2. Quels critères comptent le plus (coût, performance, facilité d'utilisation, scalabilité) ?\n3. Quel est le contexte (taille de l'équipe, budget, calendrier) ?\nCrée une matrice comparative structurée, évalue les compromis et fournis une recommandation claire avec raisonnement.",
        },
        summarize: {
          label: 'Résumer du contenu',
          prompt:
            'Agis comme un synthétiseur concis. Aide-moi à distiller du contenu en points clés. Demande-moi :\n1. Quel contenu dois-je résumer (partage du texte, URL ou document) ?\n2. Quelle longueur (un paragraphe, points clés, résumé exécutif) ?\n3. Qui est le public (technique, exécutif, général) ?\n4. Y a-t-il des aspects spécifiques sur lesquels se concentrer ou à exclure ?\nFournis le résumé avec les conclusions les plus importantes en premier, en préservant les détails critiques et les nuances.',
        },
        transcribeAudio: {
          label: 'Transcrire audio ou vidéo',
          prompt:
            "Aide-moi à transcrire un fichier audio ou vidéo en texte. Je gère les formats MP3, WAV, M4A et autres formats audio. Demande-moi :\n1. Quel est le fichier à transcrire (fournis le chemin du fichier) ?\n2. Dans quelle langue est l'audio ?\n3. Ai-je besoin d'horodatages pour chaque segment ?\n4. Quel est l'objectif (notes de réunion, sous-titres, archive consultable) ?\nUtilise la transcription vocale pour le convertir en texte et formate la sortie de manière appropriée.",
        },
      },
    },
    create: {
      label: 'Créer',
      items: {
        designUI: {
          label: 'Concevoir une interface',
          prompt:
            "Agis comme un designer UI/UX. Aide-moi à concevoir une interface utilisateur. Demande-moi :\n1. Quel type d'application ou fonctionnalité (app web, app mobile, tableau de bord) ?\n2. Qui sont les utilisateurs cibles et quels sont leurs objectifs ?\n3. Ai-je des préférences de design (minimaliste, coloré, corporate, ludique) ?\n4. Y a-t-il des designs de référence ou des directives de marque à suivre ?\nPropose une mise en page avec hiérarchie des composants, palette de couleurs, typographie et interactions clés.",
        },
        createPresentation: {
          label: 'Créer une présentation',
          prompt:
            'Agis comme un concepteur de présentations et conteur. Aide-moi à construire une présentation percutante. Demande-moi :\n1. Quel est le sujet et le message clé ?\n2. Qui est le public (investisseurs, équipe, clients, conférence) ?\n3. Combien de diapositives et combien de temps ai-je ?\n4. Quel style (minimaliste, riche en données, narratif, visuel) ?\nCrée un plan diapositive par diapositive avec titre, points clés et notes du présentateur pour chaque diapositive.',
        },
        brainstorm: {
          label: 'Remue-méninges',
          prompt:
            "Agis comme un stratège créatif. Aide-moi à générer des idées innovantes. Demande-moi :\n1. Quel défi ou opportunité j'explore ?\n2. Quelles contraintes existent (budget, calendrier, technologie, public) ?\n3. Qu'a-t-on déjà essayé ou envisagé ?\n4. Est-ce que je veux la quantité (beaucoup d'idées brutes) ou la qualité (quelques concepts raffinés) ?\nGénère des idées avec plusieurs cadres : hypothèses « Et si... », pensée inversée, analogies d'autres industries et combinaison de concepts existants.",
        },
        generateImage: {
          label: 'Générer une image',
          prompt:
            "Aide-moi à générer une image personnalisée avec la génération d'images par IA. Demande-moi :\n1. Que doit représenter l'image (scène, objet, concept, personnage) ?\n2. Quel style (photoréaliste, illustration, aquarelle, rendu 3D, design plat) ?\n3. Quel rapport d'aspect et taille (carré, paysage, portrait, 4K) ?\n4. Quelle ambiance et palette de couleurs (chaude, froide, vibrante, douce, sombre) ?\nCrée un prompt détaillé et génère l'image. Je peux aussi affiner à partir d'une image de référence.",
        },
        createVideo: {
          label: 'Créer une vidéo',
          prompt:
            "Aide-moi à créer une vidéo avec la génération vidéo par IA ou Remotion (vidéo basée sur React). Demande-moi :\n1. Quel type de vidéo (explicative, clip pour réseaux sociaux, démo produit, animation) ?\n2. Quel est le contenu ou le script ?\n3. Quelle durée et quel rapport d'aspect (16:9, 9:16 vertical, 1:1 carré) ?\n4. Ai-je des images de référence ou des séquences existantes à incorporer ?\nGénère la vidéo avec l'IA ou construis-la programmatiquement avec Remotion pour un contrôle créatif total.",
        },
      },
    },
    plan: {
      label: 'Planifier',
      items: {
        planProject: {
          label: 'Planifier un projet',
          prompt:
            "Agis comme un chef de projet. Aide-moi à planifier un projet du début à la fin. Demande-moi :\n1. Quel est l'objectif du projet et la définition du succès ?\n2. Quel est le calendrier et les dates limites fermes ?\n3. Quelles ressources sont disponibles (équipe, budget, outils) ?\n4. Quels sont les plus grands risques ou inconnues ?\nCrée un plan de projet avec phases, jalons, livrables, responsabilités et un calendrier réaliste avec une marge pour les risques.",
        },
        createRoadmap: {
          label: 'Créer une feuille de route',
          prompt:
            "Agis comme un stratège produit. Aide-moi à construire une feuille de route claire. Demande-moi :\n1. Pour quel produit ou initiative est-ce ?\n2. Quel est l'horizon temporel (trimestre, semestre, année) ?\n3. Quels sont les objectifs clés et les métriques de succès ?\n4. Y a-t-il des dépendances ou des attentes des parties prenantes à considérer ?\nOrganise la feuille de route en phases (Maintenant / Ensuite / Plus tard) avec des jalons clairs, des priorités et des résultats mesurables.",
        },
        organizeWorkflow: {
          label: 'Organiser le flux de travail',
          prompt:
            "Agis comme un consultant en productivité. Aide-moi à optimiser mon flux de travail. Demande-moi :\n1. Quel est mon processus actuel (décris les étapes) ?\n2. Quels sont les points de friction (goulots d'étranglement, étapes manuelles, changement de contexte) ?\n3. Quels outils j'utilise et suis prêt à utiliser ?\n4. À quoi ressemblerait le résultat idéal ?\nPropose un flux amélioré avec des opportunités d'automatisation spécifiques, des recommandations d'outils et un plan de migration étape par étape.",
        },
        writeSpec: {
          label: 'Rédiger une spécification',
          prompt:
            'Agis comme un product manager technique. Aide-moi à rédiger une spécification complète. Demande-moi :\n1. Quelle fonctionnalité ou système suis-je en train de spécifier ?\n2. Qui sont les parties prenantes (ingénierie, design, business) ?\n3. Quels sont les exigences obligatoires vs. souhaitables ?\n4. Y a-t-il des contraintes techniques ou des décisions architecturales déjà prises ?\nRédige une spécification couvrant : énoncé du problème, objectifs, non-objectifs, solution proposée, conception technique, cas limites, plan de déploiement et métriques de succès.',
        },
        manageIssues: {
          label: 'Gérer les issues du projet',
          prompt:
            "Aide-moi à gérer les issues et tâches de mon projet avec Linear. Je peux créer, mettre à jour, rechercher et organiser des issues. Demande-moi :\n1. Que dois-je faire (créer des issues, trier le backlog, planifier un sprint, vérifier l'avancement) ?\n2. Pour quel projet ou équipe est-ce ?\n3. Quelles sont les priorités et les délais ?\n4. Les issues doivent-elles être organisées par labels, jalons ou épiques ?\nAide-moi à structurer le travail : crée des issues bien rédigées avec des titres clairs, des descriptions, des priorités et des assignations.",
        },
      },
    },
  },

  // Sidebar workspace grouping
  groupByWorkspace: 'Regrouper par espace de travail',
  flatList: 'Liste plate',
  workspaceDefault: 'Par défaut',
  workspaceTasks: '{count} tâches',
  workspacePin: "Épingler l'espace de travail",
  workspacePinned: "Désépingler l'espace de travail",

  // Tâches en arrière-plan / envoi
  backgroundTasks: 'Tâches en arrière-plan',
  dispatch: 'Envoyer',
  dispatchTooltip: 'Exécuter en arrière-plan',

  // Sélecteur de modèle
  modelGroupClaude: 'Claude',
  modelGroupCodex: 'Codex',
  modelGroupOtherProviders: 'Autres fournisseurs',
  chatInputDefaultPlaceholder: 'Tapez un message...',
};
