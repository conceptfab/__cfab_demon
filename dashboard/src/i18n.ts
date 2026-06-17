import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "@/locales/en/common.json";
import plCommon from "@/locales/pl/common.json";
import { loadLanguageSettings, loadSessionSettings } from "@/lib/user-settings";
import {
  persistLanguageForDaemon,
  persistSessionSettingsForDaemon,
} from "@/lib/tauri";
import { hasTauriRuntime } from "@/lib/tauri/core";

// In the LAN web UI the server injects the shared language as a global before
// the bundle runs (see webui/server.rs), so the browser matches the desktop 1:1.
const injectedLang = (
  typeof window !== "undefined"
    ? (window as Window & { __TIMEFLOW_LANG__?: string }).__TIMEFLOW_LANG__
    : undefined
)?.toLowerCase();
const initialLanguage =
  injectedLang === "pl" || injectedLang === "en"
    ? injectedLang
    : loadLanguageSettings().code;
const initialSessionSettings = loadSessionSettings();

// Only the desktop app seeds the shared settings files. In the browser (LAN web
// UI) these would clobber the desktop's values with this browser's local
// defaults, so we read the shared language instead (see below) to stay 1:1.
if (hasTauriRuntime()) {
  void persistLanguageForDaemon(initialLanguage).catch(() => {});
  void persistSessionSettingsForDaemon(
    initialSessionSettings.minSessionDurationSeconds,
  ).catch(() => {});
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    pl: { common: plCommon },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: ["en", "pl"],
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
