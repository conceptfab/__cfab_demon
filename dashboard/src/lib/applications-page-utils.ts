import { getErrorMessage } from '@/lib/utils';

export function getMonitoredErrorMessage(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const message = getErrorMessage(error, t('ui.common.unknown_error'));
  if (message === 'monitored.exe_name_empty') {
    return t('applications_page.errors.monitored_exe_required');
  }
  if (message === 'monitored.display_name_empty') {
    return t('applications_page.errors.monitored_display_name_required');
  }
  if (message === 'monitored.not_found') {
    return t('applications_page.errors.monitored_not_found');
  }
  if (message.startsWith('monitored.already_monitored:')) {
    return t('applications_page.errors.monitored_already_added', {
      exeName: message.slice('monitored.already_monitored:'.length),
    });
  }
  if (message === 'monitored.drop_not_an_app') {
    return t('applications_page.errors.drop_not_an_app');
  }
  if (message === 'monitored.drop_shortcut_unsupported') {
    return t('applications_page.errors.drop_shortcut_unsupported');
  }
  if (message.startsWith('monitored.drop_invalid_bundle:')) {
    return t('applications_page.errors.drop_invalid_bundle', {
      detail: message.slice('monitored.drop_invalid_bundle:'.length),
    });
  }
  return message;
}
