import type React from 'react';
import {
  Rocket,
  Monitor,
  FolderKanban,
  AppWindow,
  Cpu,
  MousePointer2,
  Brain,
  ChevronLeft,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/ui-store';
import { Trans, useTranslation } from 'react-i18next';

function B({ children }: { children?: React.ReactNode }) {
  return <strong className="text-primary font-semibold">{children}</strong>;
}

export function QuickStart() {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setFirstRun = useUIStore((s) => s.setFirstRun);

  const handleStart = () => {
    setFirstRun(false);
    setCurrentPage('dashboard');
  };

  const steps = [
    {
      icon: <Monitor className="size-6" />,
      title: t('quickstart.steps.file_preparation.title'),
      desc: (
        <Trans i18nKey="quickstart.steps.file_preparation.description" />
      ),
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      icon: <FolderKanban className="size-6" />,
      title: t('quickstart.steps.projects_configuration.title'),
      desc: (
        <Trans
          i18nKey="quickstart.steps.projects_configuration.description"
          components={{ b: <B /> }}
        />
      ),
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10',
    },
    {
      icon: <AppWindow className="size-6" />,
      title: t('quickstart.steps.adding_applications.title'),
      desc: (
        <Trans
          i18nKey="quickstart.steps.adding_applications.description"
          components={{ b: <B /> }}
        />
      ),
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
    },
    {
      icon: <Cpu className="size-6" />,
      title: t('quickstart.steps.starting_daemon.title'),
      desc: (
        <Trans
          i18nKey="quickstart.steps.starting_daemon.description"
          components={{ b: <B /> }}
        />
      ),
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
    },
    {
      icon: <MousePointer2 className="size-6" />,
      title: t('quickstart.steps.assigning_sessions.title'),
      desc: (
        <Trans
          i18nKey="quickstart.steps.assigning_sessions.description"
          components={{ b: <B /> }}
        />
      ),
      color: 'text-sky-400',
      bg: 'bg-sky-400/10',
    },
    {
      icon: <Brain className="size-6" />,
      title: t('quickstart.steps.ai_training.title'),
      desc: (
        <Trans
          i18nKey="quickstart.steps.ai_training.description"
          components={{ b: <B /> }}
        />
      ),
      color: 'text-pink-400',
      bg: 'bg-pink-400/10',
    },
  ];

  return (
    <div className="flex h-full flex-col p-8 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleStart}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          {t('quickstart.actions.back')}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t('quickstart.language_hint')}
        </span>
      </div>

      <div className="text-center space-y-2 py-4">
        <div className="inline-flex p-3 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Rocket className="size-8" />
        </div>
        <h1 className="text-3xl font-light tracking-[0.2em] uppercase">
          {t('quickstart.heading.quick')}{' '}
          <span className="font-semibold">{t('quickstart.heading.start')}</span>
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed text-sm">
          {t('quickstart.intro')}
        </p>
      </div>

      <div className="flex flex-col gap-6 pb-6 w-full border-b border-border/10">
        {steps.map((step, idx) => (
          <div key={step.title} className="flex gap-8 items-start w-full group">
            <div
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset shadow-sm transition-all duration-500',
                step.bg,
                step.color,
                'ring-current/20',
              )}
            >
              <div className="scale-75">{step.icon}</div>
            </div>
            <div className="flex-1">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-primary/50 font-bold uppercase tracking-[0.2em]">
                  {t('quickstart.step_label', { step: idx + 1 })}
                </span>
                <h3 className="text-lg font-semibold tracking-tight text-foreground/90">
                  {step.title}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-5xl mt-0.5">
                {step.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center space-y-4 py-6">
        <p className="text-muted-foreground text-sm italic">
          {t('quickstart.outro')}
        </p>
        <Button
          size="lg"
          onClick={handleStart}
          className="group px-12 rounded-full font-bold tracking-widest uppercase transition-all hover:scale-105 active:scale-95 bg-primary text-primary-foreground hover:bg-primary/95 shadow-lg shadow-primary/20"
        >
          {t('quickstart.actions.lets_go')}
          <ArrowRight className="ml-2 size-4 group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>
    </div>
  );
}
