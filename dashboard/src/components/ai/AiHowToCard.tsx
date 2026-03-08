import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HowToSection {
  title: string;
  paragraphs: string[];
}

interface AiHowToCardProps {
  title: string;
  sections: HowToSection[];
}

export function AiHowToCard({ title, sections }: AiHowToCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-6">
        {sections.map((section) => (
          <div
            key={section.title}
            className="rounded-md border border-border/70 bg-background/35 p-3"
          >
            <p className="font-medium">{section.title}</p>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
