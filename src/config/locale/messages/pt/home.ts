export default {
  // Welcome screen — first impression of the product
  inputPlaceholder: 'Descreva o que você precisa...',
  reply: 'Responder...',
  replyWhileRunning: 'Adicionar contexto...',
  welcomeTitle: 'No que posso ajudar você a criar?',
  welcomeSubtitle:
    'Seu agente de IA para programação, escrita, análise e trabalho criativo — basta descrever o que você precisa.',
  greeting: {
    morning: 'Bom dia, {name}',
    afternoon: 'Boa tarde, {name}',
    evening: 'Boa noite, {name}',
    neutral: 'Olá, {name}',
  },
  addFilesOrPhotos: 'Anexar arquivos ou imagens',
  mcpServers: 'Servidores MCP',
  mcpNoServersConfigured: 'Nenhum servidor configurado',
  skills: 'Habilidades',
  skillsSearch: 'Pesquisar habilidades...',
  skillsNoSkillsFound: 'Nenhuma habilidade encontrada',
  skillsMaxReached: 'No máximo 3 habilidades podem ser fixadas por mensagem.',
  workInFolder: 'Trabalhar em uma pasta',
  selectedFolder: 'Pasta',
  removeFolder: 'Remover pasta',

  // Folder permission dialog
  folderPermission: {
    title: 'Permitir que {appName} altere arquivos em "{folderName}"?',
    description:
      'Isso concede acesso de leitura, edição e exclusão a todos os arquivos nesta pasta. Ferramentas de servidores de terceiros também podem acessar esses arquivos.',
    cancel: 'Cancelar',
    alwaysAllow: 'Sempre permitir',
    allow: 'Permitir',
  },
  recentFolders: 'Recentes',
  chooseDifferentFolder: 'Escolher uma pasta diferente',
  additionalFoldersCount: '+{count}',
  clearAllFolders: 'Limpar tudo',
  noRecentFolders: 'Nenhuma pasta recente',

  // Quick action buttons on the home screen
  quickActions: {
    createSlides: 'Criar slides',
    createSlidesPrompt: 'Crie uma apresentação profissional para mim',
    buildWebsite: 'Criar um site',
    buildWebsitePrompt: 'Construa um site moderno para mim',
    developApps: 'Criar um app',
    developAppsPrompt: 'Desenvolva um novo aplicativo para mim',
    design: 'Design de UI',
    designPrompt: 'Crie uma interface de usuário para mim',
    more: 'Mais',
  },

  // Quick action categories with expandable sub-items
  quickActionCategories: {
    write: {
      label: 'Escrever',
      items: {
        draftEmail: {
          label: 'Redigir um email',
          prompt:
            'Atue como um redator profissional de emails. Preciso redigir um email. Antes de escrever, pergunte-me:\n1. Quem é o destinatário e qual é nossa relação?\n2. Qual é o objetivo deste email?\n3. Qual tom deve ter (formal, amigável, persuasivo)?\n4. Há pontos-chave ou prazos a mencionar?\nEntão escreva o email com um assunto claro, saudação, corpo e despedida.',
        },
        writeDocs: {
          label: 'Escrever documentação',
          prompt:
            'Atue como um redator técnico. Ajude-me a criar documentação clara e bem estruturada. Pergunte-me:\n1. O que estou documentando (API, funcionalidade, processo, onboarding)?\n2. Quem é o público-alvo (desenvolvedores, usuários finais, stakeholders)?\n3. Qual formato funciona melhor (README, wiki, guia, referência)?\nEntão produza documentação com títulos adequados, exemplos de código quando relevante, e um fluxo lógico.',
        },
        editText: {
          label: 'Editar e melhorar texto',
          prompt:
            'Atue como um editor especialista. Vou compartilhar um texto que precisa de melhorias. Antes de editar, pergunte-me:\n1. Para que é o texto (blog, relatório, proposta, rede social)?\n2. Em quais aspectos devo focar (clareza, tom, gramática, concisão)?\n3. Devo preservar a voz original ou reescrever livremente?\nEntão forneça a versão melhorada com as alterações rastreadas e explique as principais melhorias.',
        },
        writeBlog: {
          label: 'Escrever um post de blog',
          prompt:
            'Atue como um estrategista de conteúdo e redator. Ajude-me a escrever um post de blog envolvente. Pergunte-me:\n1. Qual é o tema e meu ângulo único sobre ele?\n2. Quem é o público-alvo?\n3. Qual é a extensão e tom desejados (educacional, conversacional, liderança de pensamento)?\n4. Deve incluir uma chamada para ação?\nEntão estruture o post primeiro e escreva-o com uma abertura cativante, seções claras e uma conclusão forte.',
        },
        narrateText: {
          label: 'Converter texto em fala',
          prompt:
            'Ajude-me a converter texto em áudio de fala natural. Quero criar uma narração ou locução. Pergunte-me:\n1. Qual texto deve ser narrado?\n2. Qual tom e estilo (calmo, enérgico, profissional, narrativo)?\n3. Em que idioma deve ser?\n4. Onde será usado (podcast, apresentação, vídeo)?\nEntão use a ferramenta de síntese de fala para gerar o arquivo de áudio com a voz mais adequada.',
        },
      },
    },
    code: {
      label: 'Programar',
      items: {
        buildFeature: {
          label: 'Construir uma nova funcionalidade',
          prompt:
            'Atue como um desenvolvedor full-stack sênior. Ajude-me a construir uma nova funcionalidade do zero. Pergunte-me:\n1. Qual é o projeto e sua stack tecnológica?\n2. O que esta funcionalidade deve fazer (história de usuário ou requisitos)?\n3. Há padrões, APIs ou restrições existentes a seguir?\n4. Qual é a prioridade — protótipo funcional ou código pronto para produção?\nEntão planeje a implementação (estrutura de arquivos, componentes-chave, fluxo de dados) antes de escrever código.',
        },
        debugIssue: {
          label: 'Depurar um problema',
          prompt:
            'Atue como um especialista em depuração. Ajude-me a encontrar e corrigir um bug sistematicamente. Pergunte-me:\n1. Qual é o comportamento esperado vs. o que realmente acontece?\n2. Quando isso começou a ocorrer (após um deploy, alteração de código, atualização de dependência)?\n3. Quais mensagens de erro, logs ou stack traces eu vejo?\n4. O que já tentei?\nEntão me guie por um diagnóstico estruturado: reproduzir → isolar → identificar causa raiz → corrigir → verificar.',
        },
        refactorCode: {
          label: 'Refatorar código',
          prompt:
            'Atue como um especialista em qualidade de código. Ajude-me a refatorar código para melhor manutenibilidade. Pergunte-me:\n1. Qual código precisa de refatoração (compartilhe o arquivo ou descreva)?\n2. Quais são os principais problemas (duplicação, complexidade, nomenclatura, estrutura)?\n3. Há restrições (compatibilidade retroativa, cobertura de testes, convenções da equipe)?\nEntão sugira melhorias específicas com exemplos antes/depois, explicando a razão de cada mudança.',
        },
        writeTests: {
          label: 'Escrever testes',
          prompt:
            'Atue como um engenheiro de QA. Ajude-me a escrever testes abrangentes. Pergunte-me:\n1. Qual código ou funcionalidade estou testando?\n2. Qual framework de testes estou usando (Jest, Vitest, Pytest, etc.)?\n3. Quais tipos de testes são necessários (unitário, integração, e2e)?\n4. Há casos extremos ou cenários de falha que devo cobrir?\nEntão escreva testes bem organizados com nomes descritivos, setup/teardown adequados e asserções significativas.',
        },
        automateWeb: {
          label: 'Automatizar uma tarefa web',
          prompt:
            'Ajude-me a automatizar uma tarefa no navegador web usando automação de navegador. Posso navegar em páginas, preencher formulários, clicar em botões, extrair dados e tirar capturas de tela. Pergunte-me:\n1. Qual site ou aplicativo web preciso interagir?\n2. Qual é o objetivo (preencher um formulário, extrair dados, testar um fluxo, tirar capturas de tela)?\n3. Requer login ou autenticação?\n4. Os resultados devem ser salvos em um arquivo?\nEntão construa a automação passo a passo: navegar → capturar → interagir → verificar.',
        },
      },
    },
    analyze: {
      label: 'Analisar',
      items: {
        analyzeData: {
          label: 'Analisar dados',
          prompt:
            'Atue como um analista de dados. Ajude-me a analisar um conjunto de dados e extrair insights. Pergunte-me:\n1. Qual é o conjunto de dados (CSV, planilha, banco de dados, ou cole os dados)?\n2. Quais perguntas estou tentando responder?\n3. Que tipo de análise é necessária (tendências, correlações, outliers, segmentação)?\n4. Como os resultados devem ser apresentados (gráficos, tabelas, relatório resumido)?\nEntão realize a análise passo a passo, explique cada descoberta claramente e destaque insights acionáveis.',
        },
        researchTopic: {
          label: 'Pesquisar um tema',
          prompt:
            'Atue como um analista de pesquisa. Ajude-me a conduzir uma pesquisa aprofundada sobre um tema. Pergunte-me:\n1. Qual tema estou pesquisando?\n2. Qual é o objetivo (tomada de decisão, relatório, aprendizado, análise competitiva)?\n3. Qual profundidade preciso (visão geral, aprofundamento, nível especialista)?\n4. Há fontes ou perspectivas específicas que devo incluir?\nEntão organize as descobertas em seções claras com principais conclusões, evidências de apoio e fontes.',
        },
        compareOptions: {
          label: 'Comparar opções',
          prompt:
            'Atue como um analista de decisões. Ajude-me a comparar opções e fazer uma escolha informada. Pergunte-me:\n1. O que estou comparando (ferramentas, frameworks, fornecedores, estratégias)?\n2. Quais critérios são mais importantes (custo, desempenho, facilidade de uso, escalabilidade)?\n3. Qual é o contexto (tamanho da equipe, orçamento, prazo)?\nEntão crie uma matriz de comparação estruturada, pese as compensações e forneça uma recomendação clara com fundamentação.',
        },
        summarize: {
          label: 'Resumir conteúdo',
          prompt:
            'Atue como um resumidor conciso. Ajude-me a sintetizar conteúdo em pontos-chave. Pergunte-me:\n1. Qual conteúdo devo resumir (compartilhe texto, URL ou documento)?\n2. Qual extensão (um parágrafo, bullet points, resumo executivo)?\n3. Quem é o público (técnico, executivo, geral)?\n4. Há aspectos específicos para focar ou excluir?\nEntão forneça o resumo com as conclusões mais importantes primeiro, preservando detalhes críticos e nuances.',
        },
        transcribeAudio: {
          label: 'Transcrever áudio ou vídeo',
          prompt:
            'Ajude-me a transcrever um arquivo de áudio ou vídeo em texto. Posso lidar com MP3, WAV, M4A e outros formatos de áudio. Pergunte-me:\n1. Qual é o arquivo a transcrever (forneça o caminho do arquivo)?\n2. Em que idioma está o áudio?\n3. Preciso de timestamps para cada segmento?\n4. Qual é o objetivo (notas de reunião, legendas, arquivo pesquisável)?\nEntão use a transcrição de fala para converter em texto e formate a saída adequadamente.',
        },
      },
    },
    create: {
      label: 'Criar',
      items: {
        designUI: {
          label: 'Criar uma UI',
          prompt:
            'Atue como um designer de UI/UX. Ajude-me a criar uma interface de usuário. Pergunte-me:\n1. Qual é o aplicativo ou funcionalidade (app web, app mobile, dashboard)?\n2. Quem são os usuários-alvo e quais são seus objetivos?\n3. Tenho preferências de design (minimalista, colorido, corporativo, divertido)?\n4. Há designs de referência ou diretrizes de marca a seguir?\nEntão proponha um layout com hierarquia de componentes, esquema de cores, tipografia e interações-chave.',
        },
        createPresentation: {
          label: 'Criar uma apresentação',
          prompt:
            'Atue como um designer de apresentações e contador de histórias. Ajude-me a criar um deck de slides envolvente. Pergunte-me:\n1. Qual é o tema e a mensagem principal?\n2. Quem é o público (investidores, equipe, clientes, conferência)?\n3. Quantos slides e quanto tempo tenho?\n4. Qual estilo (minimalista, rico em dados, narrativo, visual)?\nEntão crie um roteiro slide a slide com título, pontos-chave e notas do apresentador para cada slide.',
        },
        brainstorm: {
          label: 'Brainstorm de ideias',
          prompt:
            "Atue como um estrategista criativo. Ajude-me a fazer brainstorm de ideias inovadoras. Pergunte-me:\n1. Qual desafio ou oportunidade estou explorando?\n2. Quais restrições existem (orçamento, prazo, tecnologia, público)?\n3. O que já foi tentado ou considerado?\n4. Quero quantidade (muitas ideias brutas) ou qualidade (poucos conceitos refinados)?\nEntão gere ideias usando múltiplas abordagens: 'E se...', pensamento reverso, analogias de outras indústrias e combinação de conceitos existentes.",
        },
        generateImage: {
          label: 'Gerar uma imagem',
          prompt:
            'Ajude-me a gerar uma imagem personalizada usando geração de imagem por IA. Pergunte-me:\n1. O que a imagem deve representar (cena, objeto, conceito, personagem)?\n2. Qual estilo (fotorrealista, ilustração, aquarela, renderização 3D, design flat)?\n3. Qual proporção e tamanho (quadrado, paisagem, retrato, 4K)?\n4. Qual clima e paleta de cores (quente, frio, vibrante, suave, escuro)?\nEntão elabore um prompt detalhado e gere a imagem. Também posso refinar com base em uma imagem de referência.',
        },
        createVideo: {
          label: 'Criar um vídeo',
          prompt:
            'Ajude-me a criar um vídeo usando geração de vídeo por IA ou Remotion (vídeo baseado em React). Pergunte-me:\n1. Qual tipo de vídeo (explicativo, clipe para redes sociais, demo de produto, animação)?\n2. Qual é o conteúdo ou roteiro?\n3. Qual duração e proporção (16:9, 9:16 para vertical, 1:1 para quadrado)?\n4. Tenho imagens de referência ou filmagens existentes para incorporar?\nEntão gere o vídeo com IA ou construa programaticamente com Remotion para controle criativo total.',
        },
      },
    },
    plan: {
      label: 'Planejar',
      items: {
        planProject: {
          label: 'Planejar um projeto',
          prompt:
            'Atue como um gerente de projetos. Ajude-me a planejar um projeto do início ao fim. Pergunte-me:\n1. Qual é o objetivo do projeto e a definição de sucesso?\n2. Qual é o cronograma e há prazos rígidos?\n3. Quais recursos estão disponíveis (equipe, orçamento, ferramentas)?\n4. Quais são os maiores riscos ou incertezas?\nEntão crie um plano de projeto com fases, marcos, entregáveis, responsáveis e um cronograma realista com margem para riscos.',
        },
        createRoadmap: {
          label: 'Criar um roadmap',
          prompt:
            'Atue como um estrategista de produto. Ajude-me a construir um roadmap claro. Pergunte-me:\n1. Para qual produto ou iniciativa é?\n2. Qual é o horizonte de tempo (trimestre, semestre, ano)?\n3. Quais são os objetivos-chave e métricas de sucesso?\n4. Há dependências ou expectativas de stakeholders a considerar?\nEntão organize o roadmap em fases (Agora / Próximo / Depois) com marcos claros, prioridades e resultados mensuráveis.',
        },
        organizeWorkflow: {
          label: 'Organizar fluxo de trabalho',
          prompt:
            'Atue como um consultor de produtividade. Ajude-me a otimizar meu fluxo de trabalho. Pergunte-me:\n1. Qual é meu processo atual (descreva as etapas)?\n2. Quais são os pontos problemáticos (gargalos, etapas manuais, troca de contexto)?\n3. Quais ferramentas estou usando e estou aberto a usar?\n4. Como seria o resultado ideal?\nEntão proponha um fluxo de trabalho melhorado com oportunidades específicas de automação, recomendações de ferramentas e um plano de migração passo a passo.',
        },
        writeSpec: {
          label: 'Escrever uma especificação',
          prompt:
            'Atue como um gerente de produto técnico. Ajude-me a escrever uma especificação completa. Pergunte-me:\n1. Qual funcionalidade ou sistema estou especificando?\n2. Quem são os stakeholders (engenharia, design, negócios)?\n3. Quais são os requisitos obrigatórios vs. desejáveis?\n4. Há restrições técnicas ou decisões de arquitetura já tomadas?\nEntão escreva uma especificação cobrindo: definição do problema, objetivos, não-objetivos, solução proposta, design técnico, casos extremos, plano de lançamento e métricas de sucesso.',
        },
        manageIssues: {
          label: 'Gerenciar issues do projeto',
          prompt:
            'Ajude-me a gerenciar minhas issues e tarefas de projeto usando o Linear. Posso criar, atualizar, pesquisar e organizar issues. Pergunte-me:\n1. O que preciso fazer (criar issues, triar backlog, planejar um sprint, revisar progresso)?\n2. Para qual projeto ou equipe é?\n3. Quais são as prioridades e prazos?\n4. As issues devem ser organizadas por labels, milestones ou epics?\nEntão me ajude a estruturar o trabalho: criar issues bem escritas com títulos claros, descrições, prioridades e atribuições.',
        },
      },
    },
  },

  // Sidebar workspace grouping
  groupByWorkspace: 'Agrupar por espaço de trabalho',
  flatList: 'Lista simples',
  workspaceDefault: 'Padrão',
  workspaceTasks: '{count} tarefas',
  workspacePin: 'Fixar espaço de trabalho',
  workspacePinned: 'Desafixar espaço de trabalho',

  // Tarefas em segundo plano / despacho
  backgroundTasks: 'Tarefas em segundo plano',
  dispatch: 'Despachar',
  dispatchTooltip: 'Executar em segundo plano',

  // Seletor de modelo
  modelGroupClaude: 'Claude',
  modelGroupCodex: 'Codex',
  modelGroupOtherProviders: 'Outros provedores',
  chatInputDefaultPlaceholder: 'Digite uma mensagem...',
};
