import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// Dev-only: podgląd na telefonie/LAN z HMR. webui_dev.py --vite ustawia tę zmienną
// na adres LAN maszyny (np. 192.168.1.98). Wtedy Vite słucha na 0.0.0.0 (localhost
// + LAN), a klient HMR łączy się po WS pod ten adres — telefon dostaje live reload.
const lanHost = process.env.TIMEFLOW_VITE_LAN_HOST;

// Backend Web UI (proces `timeflow-dashboard --headless`) do którego dev-serwer
// proxuje wywołania RPC — pozwala testować bieżący frontend z REALNYMI danymi.
const apiTarget = `http://127.0.0.1:${process.env.TIMEFLOW_WEBUI_PORT || 47892}`;

// Dev-only: wstrzykuje flagę zaufanego hosta, tak jak robi to serwer Rust dla
// loopbacka — dzięki temu dev-frontend pomija ekran logowania i woła RPC bez
// tokenu (proxy łączy się z backendem z loopbacka, więc backend i tak ufa).
// `apply: 'serve'` => NIGDY nie trafia do produkcyjnego buildu (bezpieczeństwo LAN).
function devTrustedFlag() {
  return {
    name: "timeflow-dev-trusted-flag",
    apply: "serve" as const,
    transformIndexHtml() {
      return [
        {
          tag: "script",
          children: "window.__TIMEFLOW_WEBUI_TRUSTED__=true;",
          injectTo: "head-prepend" as const,
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devTrustedFlag()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts")) return "charts";
          if (id.includes("date-fns")) return "date";
          if (id.includes("i18next") || id.includes("react-i18next")) {
            return "i18n";
          }
          if (id.includes("@tauri-apps")) return "tauri";
          if (id.includes("react-virtuoso")) return "virtual-list";
          if (id.includes("lucide-react")) {
            return "ui-kit";
          }
          if (id.includes("@radix-ui")) return "radix";
          return undefined;
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // LAN preview (telefon): słuchaj na wszystkich interfejsach. Tauri dev: konkretny
    // host. Inaczej: tylko loopback.
    host: lanHost ? "0.0.0.0" : host || false,
    // HMR przez WS. LAN: ten sam port co serwer, ale host = adres LAN (telefon wie
    // dokąd się łączyć). Tauri dev: osobny port 5175.
    hmr: lanHost
      ? { protocol: "ws", host: lanHost }
      : host
        ? { protocol: "ws", host, port: 5175 }
        : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // Proxy API do żywego backendu Web UI (47892). W trybie Tauri dev te ścieżki
    // nie są używane (IPC), więc proxy jest nieaktywne i nieszkodliwe.
    proxy: {
      "/rpc": apiTarget,
      "/auth": apiTarget,
      "/healthz": apiTarget,
    },
  },
});
