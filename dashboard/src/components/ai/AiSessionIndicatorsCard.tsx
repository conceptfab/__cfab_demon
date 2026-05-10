import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SessionIndicatorSettings } from '@/lib/user-settings';

type IndicatorKey = keyof Pick<
  SessionIndicatorSettings,
  'showAiBadge' | 'showSuggestions' | 'showScoreBreakdown'
>;

interface IndicatorItem {
  key: IndicatorKey;
  label: string;
  description: string;
}

interface AiSessionIndicatorsCardProps {
  title: string;
  description: string;
  items: IndicatorItem[];
  indicators: SessionIndicatorSettings;
  onToggle: (key: IndicatorKey, checked: boolean) => void;
}

export function AiSessionIndicatorsCard({
  title,
  description,
  items,
  indicators,
  onToggle,
}: AiSessionIndicatorsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="space-y-3">
          {items.map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-3 cursor-pointer group"
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-input accent-primary cursor-pointer"
                checked={indicators[item.key]}
                onChange={(e) => onToggle(item.key, e.target.checked)}
              />
              <div>
                <span className="text-sm font-medium group-hover:text-foreground transition-colors">
                  {item.label}
                </span>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
