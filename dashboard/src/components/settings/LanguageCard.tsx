import { Languages } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface LanguageOption {
  code: string;
  label: string;
}

interface LanguageCardProps {
  title: string;
  description: string;
  fieldLabel: string;
  rolloutNote: string;
  labelClassName: string;
  options: LanguageOption[];
  selectedCode: string;
  onSelectLanguage: (code: string) => void;
}

export function LanguageCard({
  title,
  description,
  fieldLabel,
  rolloutNote,
  labelClassName,
  options,
  selectedCode,
  onSelectLanguage,
}: LanguageCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Languages className="size-4 text-primary" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
            <label className={labelClassName}>{fieldLabel}</label>
            <div className="flex flex-wrap items-center gap-2">
              {options.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => onSelectLanguage(item.code)}
                  className={`h-8 px-4 rounded-md text-sm font-medium transition-all ${
                    selectedCode === item.code
                      ? 'bg-primary text-primary-foreground shadow-sm scale-105'
                      : 'bg-background border border-input hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{rolloutNote}</p>
      </CardContent>
    </Card>
  );
}
