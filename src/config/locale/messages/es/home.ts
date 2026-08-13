export default {
  inputPlaceholder: 'Describe lo que necesitas...',
  reply: 'Responder...',
  replyWhileRunning: 'Agregar contexto...',
  welcomeTitle: '¿En qué puedo ayudarte a crear?',
  welcomeSubtitle:
    'Tu agente de IA para programación, escritura, análisis y trabajo creativo — solo describe lo que necesitas.',
  greeting: {
    morning: 'Buenos días, {name}',
    afternoon: 'Buenas tardes, {name}',
    evening: 'Buenas noches, {name}',
    neutral: 'Hola, {name}',
  },
  addFilesOrPhotos: 'Adjuntar archivos o imágenes',
  mcpServers: 'Servidores MCP',
  mcpNoServersConfigured: 'Sin servidores configurados',
  skills: 'Habilidades',
  skillsSearch: 'Buscar habilidades...',
  skillsNoSkillsFound: 'No se encontraron habilidades',
  skillsMaxReached: 'Se pueden fijar un máximo de 3 habilidades por mensaje.',
  workInFolder: 'Trabajar en una carpeta',
  selectedFolder: 'Carpeta',
  removeFolder: 'Quitar carpeta',

  groupByWorkspace: 'Agrupar por espacio de trabajo',
  flatList: 'Lista plana',
  workspaceDefault: 'Predeterminado',
  workspaceTasks: '{count} tareas',
  workspacePin: 'Fijar espacio de trabajo',
  workspacePinned: 'Desfijar espacio de trabajo',

  // Diálogo de permisos de carpeta
  folderPermission: {
    title: '¿Permitir que {appName} modifique archivos en "{folderName}"?',
    description:
      'Esto otorga acceso de lectura, edición y eliminación a todos los archivos de esta carpeta. Las herramientas de servidores de terceros también pueden acceder a estos archivos.',
    cancel: 'Cancelar',
    alwaysAllow: 'Permitir siempre',
    allow: 'Permitir',
  },
  recentFolders: 'Recientes',
  chooseDifferentFolder: 'Elegir otra carpeta',
  additionalFoldersCount: '+{count}',
  clearAllFolders: 'Borrar todo',
  noRecentFolders: 'Sin carpetas recientes',

  quickActions: {
    createSlides: 'Crear presentación',
    createSlidesPrompt: 'Crea una presentación profesional para mí',
    buildWebsite: 'Crear sitio web',
    buildWebsitePrompt: 'Crea un sitio web moderno para mí',
    developApps: 'Crear aplicación',
    developAppsPrompt: 'Desarrolla una nueva aplicación para mí',
    design: 'Diseñar UI',
    designPrompt: 'Diseña una interfaz de usuario para mí',
    more: 'Más',
  },

  // Categorías de acciones rápidas
  quickActionCategories: {
    write: {
      label: 'Escribir',
      items: {
        draftEmail: {
          label: 'Redactar un correo',
          prompt:
            'Actúa como redactor profesional de correos. Necesito redactar un email. Antes de escribir, pregúntame:\n1. ¿Quién es el destinatario y cuál es nuestra relación?\n2. ¿Cuál es el propósito del correo?\n3. ¿Qué tono debe tener (formal, amigable, persuasivo)?\n4. ¿Hay puntos clave o plazos que mencionar?\nLuego escribe el correo con un asunto claro, saludo, cuerpo y despedida.',
        },
        writeDocs: {
          label: 'Escribir documentación',
          prompt:
            'Actúa como redactor técnico. Ayúdame a crear documentación clara y bien estructurada. Pregúntame:\n1. ¿Qué estoy documentando (API, función, proceso, incorporación)?\n2. ¿Quién es la audiencia (desarrolladores, usuarios finales, interesados)?\n3. ¿Qué formato funciona mejor (README, wiki, guía, referencia)?\nLuego produce documentación con encabezados adecuados, ejemplos de código y un flujo lógico.',
        },
        editText: {
          label: 'Editar y mejorar texto',
          prompt:
            'Actúa como editor experto. Compartiré un texto que necesita mejoras. Antes de editar, pregúntame:\n1. ¿Para qué es el texto (blog, informe, propuesta, redes sociales)?\n2. ¿En qué aspectos debo enfocarme (claridad, tono, gramática, concisión)?\n3. ¿Debo preservar la voz original o reescribir libremente?\nLuego proporciona la versión mejorada con cambios rastreados y explica las mejoras clave.',
        },
        writeBlog: {
          label: 'Escribir un blog',
          prompt:
            'Actúa como estratega de contenido y escritor. Ayúdame a escribir un artículo de blog atractivo. Pregúntame:\n1. ¿Cuál es el tema y mi enfoque único?\n2. ¿Quién es la audiencia objetivo?\n3. ¿Qué extensión y tono deseo (educativo, conversacional, liderazgo de pensamiento)?\n4. ¿Debe incluir un llamado a la acción?\nPrimero propón la estructura del artículo y luego escríbelo con un gancho atractivo, secciones claras y una conclusión sólida.',
        },
        narrateText: {
          label: 'Convertir texto a voz',
          prompt:
            'Ayúdame a convertir texto en audio de voz natural. Quiero crear una locución o narración. Pregúntame:\n1. ¿Qué texto debe narrarse?\n2. ¿Qué tono y estilo (tranquilo, enérgico, profesional, narrativo)?\n3. ¿En qué idioma debe estar?\n4. ¿Dónde se usará (podcast, presentación, video)?\nLuego usa la herramienta de síntesis de voz para generar el archivo de audio con la voz más adecuada.',
        },
      },
    },
    code: {
      label: 'Programar',
      items: {
        buildFeature: {
          label: 'Crear una función',
          prompt:
            'Actúa como desarrollador full-stack senior. Ayúdame a construir una nueva función desde cero. Pregúntame:\n1. ¿Cuál es el proyecto y su stack tecnológico?\n2. ¿Qué debe hacer esta función (historia de usuario o requisitos)?\n3. ¿Hay patrones, APIs o restricciones existentes a seguir?\n4. ¿Cuál es la prioridad — prototipo funcional o código de producción?\nPrimero planifica la implementación (estructura de archivos, componentes clave, flujo de datos) antes de escribir código.',
        },
        debugIssue: {
          label: 'Depurar un problema',
          prompt:
            'Actúa como experto en depuración. Ayúdame a encontrar y corregir un bug sistemáticamente. Pregúntame:\n1. ¿Cuál es el comportamiento esperado vs. lo que realmente sucede?\n2. ¿Cuándo comenzó a ocurrir (después de un despliegue, cambio de código, actualización de dependencias)?\n3. ¿Qué mensajes de error, logs o stack traces veo?\n4. ¿Qué he intentado ya?\nGuíame en un diagnóstico estructurado: reproducir → aislar → identificar causa raíz → corregir → verificar.',
        },
        refactorCode: {
          label: 'Refactorizar código',
          prompt:
            'Actúa como experto en calidad de código. Ayúdame a refactorizar código para mejor mantenibilidad. Pregúntame:\n1. ¿Qué código necesita refactorización (comparte el archivo o descríbelo)?\n2. ¿Cuáles son los principales problemas (duplicación, complejidad, nomenclatura, estructura)?\n3. ¿Hay restricciones (compatibilidad, cobertura de pruebas, convenciones del equipo)?\nSugiere mejoras específicas con ejemplos de antes/después, explicando el razonamiento de cada cambio.',
        },
        writeTests: {
          label: 'Escribir pruebas',
          prompt:
            'Actúa como ingeniero de QA. Ayúdame a escribir pruebas completas. Pregúntame:\n1. ¿Qué código o función estoy probando?\n2. ¿Qué framework de pruebas uso (Jest, Vitest, Pytest, etc.)?\n3. ¿Qué tipos de pruebas necesito (unitarias, integración, e2e)?\n4. ¿Hay casos límite o escenarios de fallo que cubrir?\nEscribe pruebas bien organizadas con nombres descriptivos, setup/teardown adecuado y aserciones significativas.',
        },
        automateWeb: {
          label: 'Automatizar tarea web',
          prompt:
            'Ayúdame a automatizar una tarea del navegador web usando automatización del navegador. Puedo navegar páginas, llenar formularios, hacer clic en botones, extraer datos y tomar capturas. Pregúntame:\n1. ¿Con qué sitio web o aplicación necesito interactuar?\n2. ¿Cuál es el objetivo (llenar formulario, extraer datos, probar flujo, capturas)?\n3. ¿Requiere inicio de sesión o autenticación?\n4. ¿Los resultados deben guardarse en un archivo?\nConstruye la automatización paso a paso: navegar → capturar → interactuar → verificar.',
        },
      },
    },
    analyze: {
      label: 'Analizar',
      items: {
        analyzeData: {
          label: 'Analizar datos',
          prompt:
            'Actúa como analista de datos. Ayúdame a analizar un conjunto de datos y extraer información. Pregúntame:\n1. ¿Cuál es el conjunto de datos (CSV, hoja de cálculo, base de datos o pega los datos)?\n2. ¿Qué preguntas intento responder?\n3. ¿Qué tipo de análisis se necesita (tendencias, correlaciones, valores atípicos, segmentación)?\n4. ¿Cómo deben presentarse los resultados (gráficos, tablas, informe resumen)?\nRealiza el análisis paso a paso, explica cada hallazgo claramente y destaca información accionable.',
        },
        researchTopic: {
          label: 'Investigar un tema',
          prompt:
            'Actúa como analista de investigación. Ayúdame a realizar una investigación exhaustiva. Pregúntame:\n1. ¿Qué tema estoy investigando?\n2. ¿Cuál es el propósito (toma de decisiones, informe, aprendizaje, análisis competitivo)?\n3. ¿Qué profundidad necesito (resumen, análisis profundo, nivel experto)?\n4. ¿Hay fuentes o perspectivas específicas que incluir?\nOrganiza los hallazgos en secciones claras con conclusiones clave, evidencia de soporte y fuentes.',
        },
        compareOptions: {
          label: 'Comparar opciones',
          prompt:
            'Actúa como analista de decisiones. Ayúdame a comparar opciones y tomar una decisión informada. Pregúntame:\n1. ¿Qué estoy comparando (herramientas, frameworks, proveedores, estrategias)?\n2. ¿Qué criterios importan más (costo, rendimiento, facilidad de uso, escalabilidad)?\n3. ¿Cuál es el contexto (tamaño del equipo, presupuesto, cronograma)?\nCrea una matriz comparativa estructurada, evalúa las compensaciones y proporciona una recomendación clara con razonamiento.',
        },
        summarize: {
          label: 'Resumir contenido',
          prompt:
            'Actúa como sintetizador conciso. Ayúdame a destilar contenido en puntos clave. Pregúntame:\n1. ¿Qué contenido debo resumir (comparte texto, URL o documento)?\n2. ¿Qué extensión (un párrafo, puntos, resumen ejecutivo)?\n3. ¿Quién es la audiencia (técnica, ejecutiva, general)?\n4. ¿Hay aspectos específicos en los que enfocarme o excluir?\nProporciona el resumen con las conclusiones más importantes primero, preservando detalles críticos y matices.',
        },
        transcribeAudio: {
          label: 'Transcribir audio o video',
          prompt:
            'Ayúdame a transcribir un archivo de audio o video a texto. Puedo manejar MP3, WAV, M4A y otros formatos de audio. Pregúntame:\n1. ¿Cuál es el archivo a transcribir (proporciona la ruta)?\n2. ¿En qué idioma está el audio?\n3. ¿Necesito marcas de tiempo para cada segmento?\n4. ¿Cuál es el propósito (notas de reunión, subtítulos, archivo buscable)?\nUsa la transcripción de voz para convertirlo a texto y formatea la salida apropiadamente.',
        },
      },
    },
    create: {
      label: 'Crear',
      items: {
        designUI: {
          label: 'Diseñar una interfaz',
          prompt:
            'Actúa como diseñador UI/UX. Ayúdame a diseñar una interfaz de usuario. Pregúntame:\n1. ¿Qué tipo de aplicación o función (app web, app móvil, dashboard)?\n2. ¿Quiénes son los usuarios objetivo y cuáles son sus metas?\n3. ¿Tengo preferencias de diseño (minimalista, colorido, corporativo, lúdico)?\n4. ¿Hay diseños de referencia o guías de marca a seguir?\nPropón un diseño con jerarquía de componentes, esquema de colores, tipografía e interacciones clave.',
        },
        createPresentation: {
          label: 'Crear una presentación',
          prompt:
            'Actúa como diseñador de presentaciones y narrador. Ayúdame a crear una presentación impactante. Pregúntame:\n1. ¿Cuál es el tema y mensaje clave?\n2. ¿Quién es la audiencia (inversores, equipo, clientes, conferencia)?\n3. ¿Cuántas diapositivas y cuánto tiempo tengo?\n4. ¿Qué estilo (minimalista, con muchos datos, narrativo, visual)?\nCrea un esquema diapositiva por diapositiva con título, puntos clave y notas del presentador.',
        },
        brainstorm: {
          label: 'Lluvia de ideas',
          prompt:
            'Actúa como estratega creativo. Ayúdame a generar ideas innovadoras. Pregúntame:\n1. ¿Qué desafío u oportunidad estoy explorando?\n2. ¿Qué restricciones existen (presupuesto, cronograma, tecnología, audiencia)?\n3. ¿Qué se ha intentado o considerado ya?\n4. ¿Quiero cantidad (muchas ideas preliminares) o calidad (pocos conceptos refinados)?\nGenera ideas usando múltiples marcos: hipótesis "¿Y si...?", pensamiento inverso, analogías de otras industrias y combinación de conceptos existentes.',
        },
        generateImage: {
          label: 'Generar una imagen',
          prompt:
            'Ayúdame a generar una imagen personalizada usando generación de imágenes con IA. Pregúntame:\n1. ¿Qué debe representar la imagen (escena, objeto, concepto, personaje)?\n2. ¿Qué estilo (fotorrealista, ilustración, acuarela, 3D, diseño plano)?\n3. ¿Qué relación de aspecto y tamaño (cuadrado, horizontal, vertical, 4K)?\n4. ¿Qué ambiente y paleta de colores (cálido, frío, vibrante, suave, oscuro)?\nCrea un prompt detallado y genera la imagen. También puedo refinar a partir de una imagen de referencia.',
        },
        createVideo: {
          label: 'Crear un video',
          prompt:
            'Ayúdame a crear un video usando generación de video con IA o Remotion (video basado en React). Pregúntame:\n1. ¿Qué tipo de video (explicativo, clip para redes sociales, demo de producto, animación)?\n2. ¿Cuál es el contenido o guion?\n3. ¿Qué duración y relación de aspecto (16:9, 9:16 vertical, 1:1 cuadrado)?\n4. ¿Tengo imágenes de referencia o material existente para incorporar?\nGenera el video con IA o constrúyelo programáticamente con Remotion para control creativo total.',
        },
      },
    },
    plan: {
      label: 'Planificar',
      items: {
        planProject: {
          label: 'Planificar un proyecto',
          prompt:
            'Actúa como gerente de proyecto. Ayúdame a planificar un proyecto de principio a fin. Pregúntame:\n1. ¿Cuál es el objetivo del proyecto y la definición de éxito?\n2. ¿Cuál es el cronograma y las fechas límite?\n3. ¿Qué recursos están disponibles (equipo, presupuesto, herramientas)?\n4. ¿Cuáles son los mayores riesgos o incógnitas?\nCrea un plan de proyecto con fases, hitos, entregables, responsables y un cronograma realista con margen para riesgos.',
        },
        createRoadmap: {
          label: 'Crear una hoja de ruta',
          prompt:
            'Actúa como estratega de producto. Ayúdame a construir una hoja de ruta clara. Pregúntame:\n1. ¿Para qué producto o iniciativa es?\n2. ¿Cuál es el horizonte temporal (trimestre, semestre, año)?\n3. ¿Cuáles son los objetivos clave y métricas de éxito?\n4. ¿Hay dependencias o expectativas de interesados a considerar?\nOrganiza la hoja de ruta en fases (Ahora / Siguiente / Después) con hitos claros, prioridades y resultados medibles.',
        },
        organizeWorkflow: {
          label: 'Organizar flujo de trabajo',
          prompt:
            'Actúa como consultor de productividad. Ayúdame a optimizar mi flujo de trabajo. Pregúntame:\n1. ¿Cuál es mi proceso actual (describe los pasos)?\n2. ¿Cuáles son los puntos de dolor (cuellos de botella, pasos manuales, cambio de contexto)?\n3. ¿Qué herramientas estoy usando y dispuesto a usar?\n4. ¿Cómo sería el resultado ideal?\nPropón un flujo mejorado con oportunidades específicas de automatización, recomendaciones de herramientas y un plan de migración paso a paso.',
        },
        writeSpec: {
          label: 'Escribir especificación',
          prompt:
            'Actúa como product manager técnico. Ayúdame a escribir una especificación completa. Pregúntame:\n1. ¿Qué función o sistema estoy especificando?\n2. ¿Quiénes son los interesados (ingeniería, diseño, negocio)?\n3. ¿Cuáles son los requisitos obligatorios vs. opcionales?\n4. ¿Hay restricciones técnicas o decisiones arquitectónicas ya tomadas?\nEscribe una especificación que cubra: planteamiento del problema, objetivos, no-objetivos, solución propuesta, diseño técnico, casos límite, plan de lanzamiento y métricas de éxito.',
        },
        manageIssues: {
          label: 'Gestionar issues del proyecto',
          prompt:
            'Ayúdame a gestionar los issues y tareas de mi proyecto usando Linear. Puedo crear, actualizar, buscar y organizar issues. Pregúntame:\n1. ¿Qué necesito hacer (crear issues, priorizar backlog, planificar sprint, revisar progreso)?\n2. ¿Para qué proyecto o equipo es?\n3. ¿Cuáles son las prioridades y plazos?\n4. ¿Deben organizarse por etiquetas, hitos o épicas?\nAyúdame a estructurar el trabajo: crea issues bien escritos con títulos claros, descripciones, prioridades y asignaciones.',
        },
      },
    },
  },

  // Tareas en segundo plano / despacho
  backgroundTasks: 'Tareas en segundo plano',
  dispatch: 'Despachar',
  dispatchTooltip: 'Ejecutar en segundo plano',

  // Selector de modelo
  modelGroupClaude: 'Claude',
  modelGroupCodex: 'Codex',
  modelGroupOtherProviders: 'Otros proveedores',
  chatInputDefaultPlaceholder: 'Escribe un mensaje...',
};
