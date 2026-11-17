import { SidebarProvider } from "../ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import TitleBar from "./TitleBar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar />
        {
}
        <main className="flex-1 flex flex-col min-h-screen min-w-0">
          <TitleBar />
          {
}
          <div className="flex-1 overflow-auto mt-12 page-transition content-panel">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
