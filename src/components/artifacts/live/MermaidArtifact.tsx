import { MermaidView } from '@/components/mermaid/MermaidView';

interface MermaidArtifactProps {
  source: string;
  className?: string;
}

export function MermaidArtifact({ source, className }: MermaidArtifactProps) {
  return <MermaidView source={source} className={className} />;
}
