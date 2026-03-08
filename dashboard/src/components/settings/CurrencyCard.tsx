import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CurrencyItem {
  code: string;
  symbol: string;
}

interface CurrencyCardProps {
  title: string;
  description: string;
  activeCurrencyLabel: string;
  labelClassName: string;
  currencies: CurrencyItem[];
  selectedCode: string;
  onSelectCurrency: (code: string) => void;
}

export function CurrencyCard({
  title,
  description,
  activeCurrencyLabel,
  labelClassName,
  currencies,
  selectedCode,
  onSelectCurrency,
}: CurrencyCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
            <label className={labelClassName}>{activeCurrencyLabel}</label>
            <div className="flex items-center gap-2">
              {currencies.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => onSelectCurrency(item.code)}
                  className={`h-8 px-4 rounded-md text-sm font-medium transition-all ${
                    selectedCode === item.code
                      ? 'bg-primary text-primary-foreground shadow-sm scale-105'
                      : 'bg-background border border-input hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {item.code}{' '}
                  <span className="opacity-50 text-[10px] ml-1">
                    ({item.symbol})
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
