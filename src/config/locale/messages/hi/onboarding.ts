export default {
  // Step indicator
  stepOf: 'चरण {current} / {total}',
  next: 'अगला',
  back: 'वापस',
  skip: 'छोड़ें',
  getStarted: 'शुरू करें',

  // Step 1: Welcome & Profile
  welcomeTitle: '{appName} में आपका स्वागत है',
  welcomeSubtitle: 'आइए आपके अनुभव को व्यक्तिगत बनाएँ — इसमें बस एक मिनट लगेगा।',
  enterName: 'अपना नाम दर्ज करें',
  uploadAvatar: 'अवतार अपलोड करें',

  // Step 2: Appearance
  appearanceTitle: 'अपना लुक चुनें',
  appearanceSubtitle: 'एक थीम और स्टाइल चुनें जो आपको सही लगे।',
  themeLabel: 'थीम',
  light: 'लाइट',
  dark: 'डार्क',
  system: 'सिस्टम',
  backgroundLabel: 'बैकग्राउंड',
  bgDefault: 'डिफ़ॉल्ट',
  bgWarm: 'गर्म',
  bgCool: 'शीतल',
  languageLabel: 'भाषा',

  // Step 3: AI Provider
  providerTitle: 'AI प्रदाता कनेक्ट करें',
  providerSubtitle:
    'अपने AI एजेंट को चलाने के लिए एक API कुंजी जोड़ें। आप इसे बाद में सेटिंग्स में कभी भी बदल सकते हैं।',
  providerOptionalNote:
    'यह वैकल्पिक है — यदि आपके पास Claude सब्सक्रिप्शन (Max/Team/Enterprise) है, तो ऐप API कुंजी के बिना काम करता है।',
  selectProvider: 'प्रदाता चुनें',
  apiKey: 'API कुंजी',
  enterApiKey: 'अपनी API कुंजी यहाँ पेस्ट करें',
  getApiKey: 'API कुंजी प्राप्त करें',
  providerConfigured: 'कॉन्फ़िगर किया गया',
  testConnection: 'कनेक्शन परीक्षण',
  testingConnection: 'परीक्षण कर रहे हैं...',
  connectionSuccess: 'सफलतापूर्वक कनेक्ट हुआ',
  connectionFailed: 'कनेक्शन विफल',

  // Step 4: Local Models
  modelsTitle: 'लोकल मॉडल',
  modelsSubtitle:
    'ऑफ़लाइन स्पीच और मेमोरी के लिए ऑन-डिवाइस मॉडल डाउनलोड करें। ये वैकल्पिक हैं और बाद में डाउनलोड किए जा सकते हैं।',
  sttModelLabel: 'स्पीच-टू-टेक्स्ट (SenseVoice)',
  sttModelDescription: 'वॉइस इनपुट को स्थानीय रूप से ट्रांसक्राइब करें (~300 MB)',
  ttsModelLabel: 'टेक्स्ट-टू-स्पीच (Kokoro)',
  ttsModelDescription: 'प्रतिक्रियाएँ स्थानीय रूप से ज़ोर से पढ़ें (~180 MB)',
  embeddingModelLabel: 'मेमोरी एम्बेडिंग',
  embeddingModelDescription:
    'क्रॉस-सत्र रिकॉल के लिए सिमेंटिक मेमोरी सक्षम करें (~340 MB)',
  ollamaLabel: 'Ollama (लोकल LLM)',
  ollamaDescription:
    'Ollama के साथ ओपन-सोर्स मॉडल स्थानीय रूप से चलाएँ। कोई API कुंजी आवश्यक नहीं।',
  ollamaUrl: 'सर्वर URL',
  ollamaUrlPlaceholder: 'http://localhost:11434',
  ollamaConnected: 'कनेक्टेड',
  ollamaDisconnected: 'नहीं चल रहा',
  ollamaTest: 'परीक्षण',
  ollamaTesting: 'परीक्षण कर रहे हैं...',
  download: 'डाउनलोड करें',
  downloading: 'डाउनलोड हो रहा है...',
  downloaded: 'तैयार',
  downloadFailed: 'विफल',
  retry: 'पुनः प्रयास',
  modelOptional: 'वैकल्पिक',
  modelDownloadComplete: '{modelName} तैयार है',

  // Step 5: All Set
  readyTitle: 'सब तैयार है!',
  readySubtitle:
    'सब कुछ कॉन्फ़िगर हो गया है। आप इन सेटिंग्स को बाद में कभी भी बदल सकते हैं।',
  readySummaryProfile: 'प्रोफ़ाइल',
  readySummaryTheme: 'थीम',
  readySummaryProviders: 'AI प्रदाता',
  readySummaryModels: 'लोकल मॉडल',
  readyNoneConfigured: 'कोई कॉन्फ़िगर नहीं',
  readyNoneDownloaded: 'कोई डाउनलोड नहीं',
};
