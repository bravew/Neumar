export default {
  // Welcome screen — first impression of the product
  inputPlaceholder: 'बताएँ आपको क्या चाहिए...',
  reply: 'उत्तर दें...',
  replyWhileRunning: 'संदर्भ जोड़ें...',
  welcomeTitle: 'मैं आपके लिए क्या बना सकता हूँ?',
  welcomeSubtitle:
    'कोडिंग, लेखन, विश्लेषण और रचनात्मक कार्य के लिए आपका AI एजेंट — बस बताएँ आपको क्या चाहिए।',
  greeting: {
    morning: 'सुप्रभात, {name}',
    afternoon: 'नमस्ते, {name}',
    evening: 'शुभ संध्या, {name}',
    neutral: 'नमस्ते, {name}',
  },
  addFilesOrPhotos: 'फ़ाइलें या छवियाँ संलग्न करें',
  mcpServers: 'MCP सर्वर',
  mcpNoServersConfigured: 'कोई सर्वर कॉन्फ़िगर नहीं है',
  skills: 'कौशल',
  skillsSearch: 'कौशल खोजें...',
  skillsNoSkillsFound: 'कोई कौशल नहीं मिला',
  skillsMaxReached: 'प्रति संदेश अधिकतम 3 कौशल पिन किए जा सकते हैं।',
  workInFolder: 'फ़ोल्डर में काम करें',
  selectedFolder: 'फ़ोल्डर',
  removeFolder: 'फ़ोल्डर हटाएँ',

  // Folder permission dialog
  folderPermission: {
    title: 'क्या {appName} को "{folderName}" में फ़ाइलें बदलने की अनुमति दें?',
    description:
      'यह इस फ़ोल्डर की सभी फ़ाइलों को पढ़ने, संपादित करने और हटाने की अनुमति देता है। तृतीय-पक्ष सर्वर के टूल भी इन फ़ाइलों तक पहुँच सकते हैं।',
    cancel: 'रद्द करें',
    alwaysAllow: 'हमेशा अनुमति दें',
    allow: 'अनुमति दें',
  },
  recentFolders: 'हाल के',
  chooseDifferentFolder: 'कोई अन्य फ़ोल्डर चुनें',
  additionalFoldersCount: '+{count}',
  clearAllFolders: 'सभी हटाएं',
  noRecentFolders: 'कोई हाल का फ़ोल्डर नहीं',

  // Quick action buttons on the home screen
  quickActions: {
    createSlides: 'स्लाइड बनाएँ',
    createSlidesPrompt: 'मेरे लिए एक पेशेवर प्रस्तुति बनाएँ',
    buildWebsite: 'वेबसाइट बनाएँ',
    buildWebsitePrompt: 'मेरे लिए एक आधुनिक वेबसाइट बनाएँ',
    developApps: 'ऐप बनाएँ',
    developAppsPrompt: 'मेरे लिए एक नया ऐप्लिकेशन विकसित करें',
    design: 'UI डिज़ाइन करें',
    designPrompt: 'मेरे लिए एक यूज़र इंटरफ़ेस डिज़ाइन करें',
    more: 'और',
  },

  // Quick action categories with expandable sub-items
  quickActionCategories: {
    write: {
      label: 'लिखें',
      items: {
        draftEmail: {
          label: 'ईमेल ड्राफ़्ट करें',
          prompt:
            'Act as a professional email writer. I need to draft an email. Before writing, ask me:\n1. Who is the recipient and what is our relationship?\n2. What is the purpose of this email?\n3. What tone should it have (formal, friendly, persuasive)?\n4. Are there any key points or deadlines to mention?\nThen write the email with a clear subject line, greeting, body, and sign-off.',
        },
        writeDocs: {
          label: 'दस्तावेज़ लिखें',
          prompt:
            'Act as a technical writer. Help me create clear, well-structured documentation. Ask me:\n1. What am I documenting (API, feature, process, onboarding)?\n2. Who is the target audience (developers, end-users, stakeholders)?\n3. What format works best (README, wiki, guide, reference)?\nThen produce documentation with proper headings, code examples where relevant, and a logical flow.',
        },
        editText: {
          label: 'टेक्स्ट संपादित और सुधारें',
          prompt:
            "Act as an expert editor. I'll share text that needs improvement. Before editing, ask me:\n1. What is the text for (blog, report, proposal, social media)?\n2. What aspects should I focus on (clarity, tone, grammar, conciseness)?\n3. Should I preserve the original voice or rewrite freely?\nThen provide the improved version with tracked changes and explain the key improvements.",
        },
        writeBlog: {
          label: 'ब्लॉग पोस्ट लिखें',
          prompt:
            'Act as a content strategist and writer. Help me write a compelling blog post. Ask me:\n1. What is the topic and my unique angle on it?\n2. Who is the target audience?\n3. What is the desired length and tone (educational, conversational, thought-leadership)?\n4. Should it include a call-to-action?\nThen outline the post structure first, and write it with an engaging hook, clear sections, and a strong conclusion.',
        },
        narrateText: {
          label: 'टेक्स्ट को स्पीच में बदलें',
          prompt:
            'Help me convert text into natural-sounding speech audio. I want to create a voiceover or narration. Ask me:\n1. What text should be narrated?\n2. What tone and style (calm, energetic, professional, storytelling)?\n3. What language should it be in?\n4. Where will it be used (podcast, presentation, video)?\nThen use the speech synthesis tool to generate the audio file with the best-fitting voice.',
        },
      },
    },
    code: {
      label: 'कोड',
      items: {
        buildFeature: {
          label: 'नई सुविधा बनाएँ',
          prompt:
            'Act as a senior full-stack developer. Help me build a new feature from scratch. Ask me:\n1. What is the project and its tech stack?\n2. What should this feature do (user story or requirements)?\n3. Are there any existing patterns, APIs, or constraints to follow?\n4. What is the priority — working prototype or production-ready code?\nThen plan the implementation (file structure, key components, data flow) before writing code.',
        },
        debugIssue: {
          label: 'समस्या डीबग करें',
          prompt:
            'Act as a debugging expert. Help me systematically find and fix a bug. Ask me:\n1. What is the expected behavior vs. what actually happens?\n2. When did this start occurring (after a deploy, code change, dependency update)?\n3. What error messages, logs, or stack traces do I see?\n4. What have I already tried?\nThen walk me through a structured diagnosis: reproduce → isolate → identify root cause → fix → verify.',
        },
        refactorCode: {
          label: 'कोड रीफ़ैक्टर करें',
          prompt:
            'Act as a code quality expert. Help me refactor code for better maintainability. Ask me:\n1. What code needs refactoring (share the file or describe it)?\n2. What are the main pain points (duplication, complexity, naming, structure)?\n3. Are there any constraints (backwards compatibility, test coverage, team conventions)?\nThen suggest specific improvements with before/after examples, explaining the rationale for each change.',
        },
        writeTests: {
          label: 'टेस्ट लिखें',
          prompt:
            'Act as a QA engineer. Help me write comprehensive tests. Ask me:\n1. What code or feature am I testing?\n2. What testing framework am I using (Jest, Vitest, Pytest, etc.)?\n3. What types of tests are needed (unit, integration, e2e)?\n4. Are there edge cases or failure scenarios I should cover?\nThen write well-organized tests with descriptive names, proper setup/teardown, and meaningful assertions.',
        },
        automateWeb: {
          label: 'वेब कार्य स्वचालित करें',
          prompt:
            'Help me automate a web browser task using browser automation. I can navigate pages, fill forms, click buttons, extract data, and take screenshots. Ask me:\n1. What website or web app do I need to interact with?\n2. What is the goal (fill a form, scrape data, test a workflow, take screenshots)?\n3. Does it require login or authentication?\n4. Should results be saved to a file?\nThen build the automation step by step: navigate → snapshot → interact → verify.',
        },
      },
    },
    analyze: {
      label: 'विश्लेषण',
      items: {
        analyzeData: {
          label: 'डेटा का विश्लेषण करें',
          prompt:
            'Act as a data analyst. Help me analyze a dataset and extract insights. Ask me:\n1. What is the dataset (CSV, spreadsheet, database, or paste the data)?\n2. What questions am I trying to answer?\n3. What kind of analysis is needed (trends, correlations, outliers, segmentation)?\n4. How should results be presented (charts, tables, summary report)?\nThen perform the analysis step by step, explain each finding clearly, and highlight actionable insights.',
        },
        researchTopic: {
          label: 'विषय पर शोध करें',
          prompt:
            'Act as a research analyst. Help me conduct thorough research on a topic. Ask me:\n1. What topic am I researching?\n2. What is the purpose (decision-making, report, learning, competitive analysis)?\n3. What depth do I need (overview, deep-dive, expert-level)?\n4. Are there specific sources or perspectives I should include?\nThen organize findings into clear sections with key takeaways, supporting evidence, and sources.',
        },
        compareOptions: {
          label: 'विकल्पों की तुलना करें',
          prompt:
            'Act as a decision analyst. Help me compare options and make an informed choice. Ask me:\n1. What am I comparing (tools, frameworks, vendors, strategies)?\n2. What criteria matter most (cost, performance, ease of use, scalability)?\n3. What is the context (team size, budget, timeline)?\nThen create a structured comparison matrix, weigh the trade-offs, and provide a clear recommendation with reasoning.',
        },
        summarize: {
          label: 'सामग्री का सारांश बनाएँ',
          prompt:
            'Act as a concise summarizer. Help me distill content into key points. Ask me:\n1. What content should I summarize (share text, URL, or document)?\n2. What length (one-paragraph, bullet points, executive summary)?\n3. Who is the audience (technical, executive, general)?\n4. Are there specific aspects to focus on or exclude?\nThen provide the summary with the most important takeaways first, preserving critical details and nuance.',
        },
        transcribeAudio: {
          label: 'ऑडियो या वीडियो ट्रांसक्राइब करें',
          prompt:
            'Help me transcribe an audio or video file into text. I can handle MP3, WAV, M4A, and other audio formats. Ask me:\n1. What is the file to transcribe (provide the file path)?\n2. What language is the audio in?\n3. Do I need timestamps for each segment?\n4. What is the purpose (meeting notes, subtitles, searchable archive)?\nThen use speech transcription to convert it to text and format the output appropriately.',
        },
      },
    },
    create: {
      label: 'बनाएँ',
      items: {
        designUI: {
          label: 'UI डिज़ाइन करें',
          prompt:
            'Act as a UI/UX designer. Help me design a user interface. Ask me:\n1. What is the application or feature (web app, mobile app, dashboard)?\n2. Who are the target users and what are their goals?\n3. Do I have design preferences (minimal, colorful, corporate, playful)?\n4. Are there reference designs or brand guidelines to follow?\nThen propose a layout with component hierarchy, color scheme, typography, and key interactions.',
        },
        createPresentation: {
          label: 'प्रस्तुति बनाएँ',
          prompt:
            'Act as a presentation designer and storyteller. Help me build a compelling slide deck. Ask me:\n1. What is the topic and key message?\n2. Who is the audience (investors, team, clients, conference)?\n3. How many slides and how much time do I have?\n4. What style (minimalist, data-heavy, storytelling, visual)?\nThen create a slide-by-slide outline with title, key points, and speaker notes for each slide.',
        },
        brainstorm: {
          label: 'विचार-मंथन करें',
          prompt:
            "Act as a creative strategist. Help me brainstorm innovative ideas. Ask me:\n1. What challenge or opportunity am I exploring?\n2. What constraints exist (budget, timeline, technology, audience)?\n3. What has already been tried or considered?\n4. Do I want quantity (many rough ideas) or quality (few refined concepts)?\nThen generate ideas using multiple frameworks: 'What if...', reversal thinking, analogies from other industries, and combination of existing concepts.",
        },
        generateImage: {
          label: 'छवि बनाएँ',
          prompt:
            'Help me generate a custom image using AI image generation. Ask me:\n1. What should the image depict (scene, object, concept, character)?\n2. What style (photorealistic, illustration, watercolor, 3D render, flat design)?\n3. What aspect ratio and size (square, landscape, portrait, 4K)?\n4. What mood and color palette (warm, cool, vibrant, muted, dark)?\nThen craft a detailed prompt and generate the image. I can also refine based on a reference image.',
        },
        createVideo: {
          label: 'वीडियो बनाएँ',
          prompt:
            'Help me create a video using AI video generation or Remotion (React-based video). Ask me:\n1. What type of video (explainer, social media clip, product demo, animation)?\n2. What is the content or script?\n3. What duration and aspect ratio (16:9, 9:16 for vertical, 1:1 for square)?\n4. Do I have reference images or existing footage to incorporate?\nThen either generate the video with AI or build it programmatically with Remotion for full creative control.',
        },
      },
    },
    plan: {
      label: 'योजना',
      items: {
        planProject: {
          label: 'प्रोजेक्ट की योजना बनाएँ',
          prompt:
            'Act as a project manager. Help me plan a project from start to finish. Ask me:\n1. What is the project goal and definition of success?\n2. What is the timeline and any hard deadlines?\n3. What resources are available (team, budget, tools)?\n4. What are the biggest risks or unknowns?\nThen create a project plan with phases, milestones, deliverables, ownership, and a realistic timeline with buffer for risks.',
        },
        createRoadmap: {
          label: 'रोडमैप बनाएँ',
          prompt:
            'Act as a product strategist. Help me build a clear roadmap. Ask me:\n1. What product or initiative is this for?\n2. What is the time horizon (quarter, half-year, year)?\n3. What are the key goals and success metrics?\n4. Are there dependencies or stakeholder expectations to consider?\nThen organize the roadmap into phases (Now / Next / Later) with clear milestones, priorities, and measurable outcomes.',
        },
        organizeWorkflow: {
          label: 'वर्कफ़्लो व्यवस्थित करें',
          prompt:
            'Act as a productivity consultant. Help me optimize my workflow. Ask me:\n1. What is my current process (describe the steps)?\n2. What are the pain points (bottlenecks, manual steps, context-switching)?\n3. What tools am I using and open to using?\n4. What does the ideal outcome look like?\nThen propose an improved workflow with specific automation opportunities, tool recommendations, and a step-by-step migration plan.',
        },
        writeSpec: {
          label: 'स्पेक लिखें',
          prompt:
            'Act as a technical product manager. Help me write a thorough specification. Ask me:\n1. What feature or system am I specifying?\n2. Who are the stakeholders (engineering, design, business)?\n3. What are the must-have vs. nice-to-have requirements?\n4. Are there technical constraints or architectural decisions already made?\nThen write a spec covering: problem statement, goals, non-goals, proposed solution, technical design, edge cases, rollout plan, and success metrics.',
        },
        manageIssues: {
          label: 'प्रोजेक्ट इश्यू प्रबंधित करें',
          prompt:
            'Help me manage my project issues and tasks using Linear. I can create, update, search, and organize issues. Ask me:\n1. What do I need to do (create issues, triage backlog, plan a sprint, review progress)?\n2. What project or team is this for?\n3. What are the priorities and deadlines?\n4. Should issues be organized by labels, milestones, or epics?\nThen help me structure the work: create well-written issues with clear titles, descriptions, priorities, and assignments.',
        },
      },
    },
  },

  // Sidebar workspace grouping
  groupByWorkspace: 'कार्यक्षेत्र के अनुसार समूहीकृत करें',
  flatList: 'सपाट सूची',
  workspaceDefault: 'डिफ़ॉल्ट',
  workspaceTasks: '{count} कार्य',
  workspacePin: 'कार्यक्षेत्र पिन करें',
  workspacePinned: 'कार्यक्षेत्र अनपिन करें',

  // पृष्ठभूमि कार्य / प्रेषण
  backgroundTasks: 'पृष्ठभूमि कार्य',
  dispatch: 'प्रेषण',
  dispatchTooltip: 'पृष्ठभूमि में चलाएं',

  // मॉडल सिलेक्टर
  modelGroupClaude: 'Claude',
  modelGroupCodex: 'Codex',
  modelGroupOtherProviders: 'अन्य प्रदाता',
  chatInputDefaultPlaceholder: 'संदेश लिखें...',
};
