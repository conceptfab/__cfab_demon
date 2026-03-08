import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ProjectContextMenu } from "@/components/project/ProjectContextMenu";

export function MainLayout({
  children,
  showChrome = true,
}: {
  children: ReactNode;
  showChrome?: boolean;
}) {
  if (!showChrome) {
    return (
      <div className="h-screen overflow-hidden bg-background">
        <main className="h-full overflow-y-auto">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="ml-56 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-5">{children}</main>
      </div>
      <ProjectContextMenu />
    </div>
  );
}
