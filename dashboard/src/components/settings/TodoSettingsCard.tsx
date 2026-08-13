import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TodoSettings } from '@/lib/user-settings';

interface TodoSettingsCardProps {
  title: string;
  autoCommentTitle: string;
  autoCommentDescription: string;
  todoSettings: TodoSettings;
  onAutoCommentChange: (enabled: boolean) => void;
}

export function TodoSettingsCard({
  title,
  autoCommentTitle,
  autoCommentDescription,
  todoSettings,
  onAutoCommentChange,
}: TodoSettingsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border border-border/70 bg-background/35">
          <label
            htmlFor="todoAutoSessionComment"
            className="grid cursor-pointer gap-3 p-3 transition-colors hover:bg-secondary/5 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-sky-400">
                {autoCommentTitle}
              </p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {autoCommentDescription}
              </p>
            </div>
            <button
              id="todoAutoSessionComment"
              type="button"
              role="switch"
              aria-checked={todoSettings.autoSessionComment}
              onClick={() => onAutoCommentChange(!todoSettings.autoSessionComment)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                todoSettings.autoSessionComment ? 'bg-sky-600' : 'bg-secondary'
              }`}
            >
              <span
                className={`inline-block size-3.5 rounded-full bg-white transition-transform ${
                  todoSettings.autoSessionComment
                    ? 'translate-x-4.5'
                    : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
