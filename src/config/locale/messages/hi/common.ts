export default {
  // Common actions
  save: 'सहेजें',
  cancel: 'रद्द करें',
  delete: 'हटाएँ',
  edit: 'संपादित करें',
  confirm: 'पुष्टि करें',
  reset: 'रीसेट करें',
  close: 'बंद करें',
  more: 'सभी देखें...',
  loading: 'लोड हो रहा है...',
  noData: 'यहाँ अभी कुछ नहीं है',
  search: 'खोजें',
  add: 'जोड़ें',
  remove: 'हटाएँ',
  yes: 'हाँ',
  no: 'नहीं',
  ok: 'ठीक है',
  back: 'वापस',
  next: 'अगला',
  done: 'हो गया',
  error: 'त्रुटि',
  success: 'सफल',
  warning: 'चेतावनी',
  info: 'जानकारी',

  // Expandable content
  showMore: 'और दिखाएँ',
  showLess: 'कम दिखाएँ',
  showMoreCount: '{count} और',

  // सामान्य क्रियाएँ
  dismiss: 'खारिज करें',
  refresh: 'रीफ़्रेश करें',
  stop: 'रोकें',

  // Scroll
  scrollToBottom: 'नीचे स्क्रॉल करें',

  // Task actions
  favorite: 'पसंदीदा में जोड़ें',
  unfavorite: 'पसंदीदा से हटाएँ',
  deleteTask: 'कार्य हटाएँ',
  deleteTaskConfirm: 'यह कार्य हटाएँ?',
  deleteTaskDescription:
    'यह पूर्ववत नहीं किया जा सकता। इस कार्य के सभी संदेश और फ़ाइलें स्थायी रूप से हटा दी जाएँगी।',
  deleteSessionFolder: 'सत्र फ़ोल्डर भी हटाएँ',
  deleteSessionFolderDescription:
    'यह सत्र फ़ोल्डर की सभी फ़ाइलें आपकी डिस्क से स्थायी रूप से हटा देगा।',
  sessionFolderPath: 'सत्र फ़ोल्डर:',
  viewFolder: 'फ़ोल्डर खोलें',
  renameTitle: 'नाम बदलें',
  renameTitlePlaceholder: 'नया शीर्षक दर्ज करें...',
  regenerateTitle: 'शीर्षक पुनः जनरेट करें',
  regeneratingTitle: 'जनरेट हो रहा है...',

  // API error messages — friendly, helpful, and actionable
  errors: {
    connectionFailed: 'कनेक्ट हो रहा है — कृपया प्रतीक्षा करें...',
    connectionFailedFinal:
      'सेवा तक पहुँचने में असमर्थ। कृपया अपना नेटवर्क जाँचें और पुनः प्रयास करें।',
    corsError: 'अनुरोध आपके ब्राउज़र द्वारा अवरुद्ध किया गया। कृपया सेवा कॉन्फ़िगरेशन जाँचें।',
    timeout: 'अनुरोध में बहुत अधिक समय लगा। कृपया पुनः प्रयास करें।',
    serverNotRunning: 'एजेंट सेवा नहीं चल रही है। कृपया पहले ऐप लॉन्च करें।',
    requestFailed: 'कुछ गलत हो गया: {message}',
    retrying: 'पुनः प्रयास हो रहा है ({attempt}/{max})...',
    internalError: 'एक आंतरिक त्रुटि हुई। विवरण के लिए लॉग फ़ाइल जाँचें: {logPath}',
    customApiError:
      '{baseUrl} पर कस्टम API संगत नहीं हो सकता। कृपया कॉन्फ़िगरेशन सत्यापित करें या कोई अन्य प्रदाता आज़माएँ। लॉग: {logPath}',
    openLogFile: 'लॉग फ़ाइल देखें',
    modelNotConfigured:
      'अभी तक कोई AI मॉडल कॉन्फ़िगर नहीं किया गया है। शुरू करने से पहले सेटिंग्स में जाकर अपना API एंडपॉइंट, कुंजी और मॉडल सेट करें।',
    claudeCodeNotFound:
      'Claude Code इंस्टॉल नहीं है या उपलब्ध नहीं है। आप सेटिंग्स में कस्टम AI मॉडल कॉन्फ़िगर कर सकते हैं, या Claude Code इंस्टॉल करें: npm install -g @anthropic-ai/claude-code',
    configureModel: 'मॉडल कॉन्फ़िगर करें',
    apiKeyError:
      'AI मॉडल अनुरोध विफल रहा। कृपया सेटिंग्स में अपना API URL, कुंजी और मॉडल नाम दोबारा जाँचें।',
    configureApiKey: 'सेटिंग्स खोलें',
    agentProcessError:
      'एजेंट को एक समस्या आई। कृपया अपना मॉडल कॉन्फ़िगरेशन जाँचें और पुनः प्रयास करें।',
    contextOverflow:
      'मॉडल {model} के लिए कॉन्टेक्स्ट विंडो की सीमा पूरी हो गई। बातचीत इस मॉडल के लिए बहुत लंबी है।',
    contextOverflowNewSession: 'नया सत्र शुरू करें',
    contextOverflowSwitchModel: 'मॉडल बदलें',
  },

  // Question input — when the agent asks the user
  questionInput: {
    needsInput: 'आपके इनपुट की आवश्यकता है',
    submit: 'भेजें',
    other: 'अन्य',
    customInput: 'कस्टम उत्तर',
    placeholder: 'अपना उत्तर टाइप करें...',
  },

  // Feedback dialog
  feedback: {
    title: 'प्रतिक्रिया भेजें',
    description:
      'अपने विचार साझा करके, समस्याओं की रिपोर्ट करके, या सुविधाओं का अनुरोध करके हमें बेहतर बनाने में मदद करें।',
    categoryLabel: 'श्रेणी',
    categoryBugReport: 'बग रिपोर्ट',
    categoryFeatureRequest: 'सुविधा अनुरोध',
    categoryGeneralFeedback: 'सामान्य प्रतिक्रिया',
    categoryQuestion: 'प्रश्न',
    subjectLabel: 'विषय',
    subjectPlaceholder: 'अपनी प्रतिक्रिया का संक्षिप्त सारांश',
    descriptionLabel: 'विवरण',
    descriptionPlaceholderBug:
      'क्या हुआ? आपने क्या अपेक्षा की थी? पुनः उत्पन्न करने के चरण...',
    descriptionPlaceholderFeature:
      'आप कौन सी सुविधा चाहते हैं और यह क्यों उपयोगी होगी, इसका वर्णन करें...',
    descriptionPlaceholderFeedback: 'अपने विचार, सुझाव, या अनुभव साझा करें...',
    descriptionPlaceholderQuestion:
      'आप क्या जानना चाहते हैं? कृपया यथासंभव विशिष्ट रहें...',
    emailLabel: 'ईमेल (वैकल्पिक)',
    emailPlaceholder: 'your@email.com — ताकि हम आपसे संपर्क कर सकें',
    submit: 'प्रतिक्रिया भेजें',
    submitting: 'भेजा जा रहा है...',
    successTitle: 'धन्यवाद!',
    successMessage: 'आपकी प्रतिक्रिया भेज दी गई है। हम आपके इनपुट की सराहना करते हैं!',
    errorMessage: 'प्रतिक्रिया भेजने में विफल। कृपया पुनः प्रयास करें।',
    sendAnother: 'एक और भेजें',
    menuLabel: 'प्रतिक्रिया भेजें',
  },

  // लिंक सुर���्षा मोडल
  linkSafety: {
    openExternalLink: 'ब���हरी लिंक खोलें?',
    externalLinkWarning: 'आप एक बाहरी वेबसाइट पर जाने वाले हैं।',
    copyLink: 'लिंक कॉपी करें',
    copied: 'कॉपी हो गया',
    openLink: 'लिंक ख���लें',
  },
};
