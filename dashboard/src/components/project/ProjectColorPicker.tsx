import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { PROJECT_COLORS } from '@/lib/project-colors';

interface ProjectColorPickerProps {
  currentColor: string;
  labels: { changeColor: string; chooseColor: string; saveColor: string };
  onSave: (color: string) => Promise<void>;
  /** CSS class for the dot button size, default "h-3 w-3" */
  dotClassName?: string;
}

export function ProjectColorPicker({ currentColor, labels, onSave, dotClassName }: ProjectColorPickerProps) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const applyColor = async (color: string) => {
    await onSave(color);
    setEditing(false);
    setPending(null);
  };

  return (
    <div className="relative group">
      <AppTooltip content={labels.changeColor}>
        <button
          type="button"
          aria-label={labels.changeColor}
          className={`${dotClassName || 'h-3 w-3'} rounded-full border-0 bg-transparent p-0 cursor-pointer hover:scale-125 transition-transform`}
          style={{ backgroundColor: pending && editing ? pending : currentColor }}
          onClick={() => {
            setEditing(!editing);
            setPending(null);
          }}
        />
      </AppTooltip>
      {editing && (
        <div className="absolute top-full left-0 z-50 mt-1 p-2 rounded border bg-popover shadow-md">
          <div className="flex items-center gap-1">
            <input
              type="color"
              defaultValue={currentColor}
              className="w-16 h-8 border border-border rounded cursor-pointer"
              aria-label={labels.chooseColor}
              onChange={(e) => setPending(e.target.value)}
              title={labels.chooseColor}
            />
            {pending && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-green-500 hover:text-green-400"
                aria-label={labels.saveColor}
                onClick={() => void applyColor(pending)}
                title={labels.saveColor}
              >
                <Save className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-2 flex gap-1">
            {PROJECT_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className="h-5 w-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                onClick={() => void applyColor(c)}
                aria-label={`${labels.chooseColor}: ${c}`}
                title={c}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
