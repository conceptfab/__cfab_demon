export function HelpDetailsBlock({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="text-sm space-y-4 text-foreground/90 leading-relaxed border-t border-border/10 pt-4">
      <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
        {title}
      </h4>
      <ul className="list-disc ml-5 space-y-2 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
