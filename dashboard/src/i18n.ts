import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "@/locales/en/common.json";
import plCommon from "@/locales/pl/common.json";
import { loadLanguageSettings } from "@/lib/user-settings";
import { persistLanguageForDaemon } from "@/lib/tauri";

const initialLanguage = loadLanguageSettings().code;

// Ensure language.json exists for the daemon on every dashboard start
void persistLanguageForDaemon(initialLanguage).catch(() => {});

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
