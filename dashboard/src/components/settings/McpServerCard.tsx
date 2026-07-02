import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-notification';
import { mcpApi, type McpStatus } from '@/lib/tauri';
import {
  buildClaudeCodeCommand,
  buildCodexConfig,
  buildMcpUrl,
} from '@/lib/mcp-snippets';
import { logTauriError } from '@/lib/utils';

interface McpServerCardProps {
  title: string;
  description: string;
}

export function McpServerCard({ title, description }: McpServerCardProps) {
  const { t } = useTranslation();
  const { showError, showInfo } = useToast();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    mcpApi
      .status()
      .then(setStatus)
      .catch((e) => logTauriError('load MCP status', e));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyConfig = async (enabled: boolean, readWrite: boolean) => {
    setSaving(true);
    try {
      setStatus(await mcpApi.setConfig(enabled, readWrite));
      showInfo(t('settings.mcp.saved'));
    } catch (e) {
      logTauriError('save MCP config', e);
      showError(t('settings.mcp.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setSaving(true);
    try {
      setStatus(await mcpApi.regenerateToken());
      showInfo(t('settings.mcp.token_regenerated'));
    } catch (e) {
      logTauriError('regenerate MCP token', e);
      showError(t('settings.mcp.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showInfo(t('settings.mcp.copied')))
      .catch(() => showError(t('settings.mcp.copy_failed')));
  };

  if (!status) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('settings.mcp.loading')}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-background/35 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.mcp.enable')}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('settings.mcp.enable_hint', { port: status.port })}
            </p>
          </div>
          <Switch
            checked={status.enabled}
            disabled={saving}
            onCheckedChange={(v) => void applyConfig(v, status.read_write)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-background/35 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.mcp.read_write')}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('settings.mcp.read_write_hint')}
            </p>
          </div>
          <Switch
            checked={status.read_write}
            disabled={saving || !status.enabled}
            onCheckedChange={(v) => void applyConfig(status.enabled, v)}
          />
        </div>

        <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs leading-5">
          {t('settings.mcp.backup_note')}
        </div>

        {status.enabled && (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('settings.mcp.token')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                  {status.token || t('settings.mcp.token_missing')}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(status.token)}
                  disabled={!status.token}
                  aria-label={t('settings.mcp.copy_token')}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void regenerate()}
                  disabled={saving}
                  aria-label={t('settings.mcp.regenerate_token')}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.mcp.token_hint')}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t('settings.mcp.claude_snippet')}
              </p>
              <div className="flex items-start gap-2">
                <code className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {buildClaudeCodeCommand(status.port, status.token)}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copy(buildClaudeCodeCommand(status.port, status.token))
                  }
                  aria-label={t('settings.mcp.copy_snippet')}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t('settings.mcp.codex_snippet')}
              </p>
              <div className="flex items-start gap-2">
                <code className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {buildCodexConfig(status.port, status.token)}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copy(buildCodexConfig(status.port, status.token))
                  }
                  aria-label={t('settings.mcp.copy_snippet')}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.mcp.codex_hint')}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('settings.mcp.endpoint', { url: buildMcpUrl(status.port) })} ·{' '}
              {t('settings.mcp.active_sessions', {
                count: status.active_sessions,
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
