import { CompanionSidebar } from "./components/CompanionSidebar";
import { characters, sessionGroups } from "./components/sidebar-model";

export function App() {
  return (
    <main className="app-frame">
      <CompanionSidebar characters={characters} sessions={sessionGroups} />
    </main>
  );
}
