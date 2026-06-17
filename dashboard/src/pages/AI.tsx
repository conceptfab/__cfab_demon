import { useAiPageController } from '@/hooks/useAiPageController';
import { AiPageView } from '@/pages/ai/AiPageView';

export function AIPage() {
  const controller = useAiPageController();
  return <AiPageView controller={controller} />;
}
