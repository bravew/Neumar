import { Calendar, FileText, Globe, Smartphone, Sparkles } from 'lucide-react';

/** Get icon for task based on prompt content */
export function getTaskIcon(prompt: string) {
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('网站') || lowerPrompt.includes('website')) {
    return Globe;
  }
  if (lowerPrompt.includes('应用') || lowerPrompt.includes('app')) {
    return Smartphone;
  }
  if (lowerPrompt.includes('设计') || lowerPrompt.includes('design')) {
    return Sparkles;
  }
  if (lowerPrompt.includes('文档') || lowerPrompt.includes('doc')) {
    return FileText;
  }
  return Calendar;
}

/** Allow time for the view-transition cross-fade to settle before hiding the loading spinner */
export const VIEW_TRANSITION_SETTLE_MS = 250;
