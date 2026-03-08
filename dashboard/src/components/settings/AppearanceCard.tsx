import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AppearanceCardProps {
  title: string;
  description: string;
  animationsTitle: string;
  animationsDescription: string;
  checked: boolean;
  onToggle: (enabled: boolean) => void;
}

export function AppearanceCard({
  title,
  description,
  animationsTitle,
  animationsDescription,
  checked,
  onToggle,
}: AppearanceCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          htmlFor="chartAnimationsEnabled"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{animationsTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {animationsDescription}
            </p>
          </div>
          <input
            id="chartAnimationsEnabled"
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </label>
      </CardContent>
    </Card>
  );
}
