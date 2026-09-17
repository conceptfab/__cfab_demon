import { useTranslation } from "react-i18next";
import { Clapperboard } from "lucide-react";
import { RendersIntegrationStatus } from "@/components/renders/RendersIntegrationStatus";

export function RendersPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
          <Clapperboard className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("renders_page.page_title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("renders_page.page_desc")}
          </p>
        </div>
      </div>

      <RendersIntegrationStatus />
    </div>
  );
}

export default RendersPage;
