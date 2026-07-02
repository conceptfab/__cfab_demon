import { useTranslation } from 'react-i18next';

export function HelpMcpSection() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <h2 className="text-lg font-semibold">{t('help.mcp.title')}</h2>
      <p>{t('help.mcp.what')}</p>
      <h3 className="font-medium">{t('help.mcp.when_title')}</h3>
      <p>{t('help.mcp.when')}</p>
      <h3 className="font-medium">{t('help.mcp.setup_title')}</h3>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t('help.mcp.setup_1')}</li>
        <li>{t('help.mcp.setup_2')}</li>
        <li>{t('help.mcp.setup_3')}</li>
      </ol>
      <h3 className="font-medium">{t('help.mcp.settings_title')}</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>{t('help.mcp.setting_enable')}</li>
        <li>{t('help.mcp.setting_permissions')}</li>
        <li>{t('help.mcp.setting_token')}</li>
      </ul>
      <h3 className="font-medium">{t('help.mcp.limits_title')}</h3>
      <p>{t('help.mcp.limits')}</p>
    </div>
  );
}
