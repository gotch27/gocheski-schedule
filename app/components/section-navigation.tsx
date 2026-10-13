export function SectionNavigation({ active }: { active: "calendar" | "goals" }) {
  return (
    <nav className="section-navigation" aria-label="Sections">
      <a href="/schedule" aria-current={active === "calendar" ? "page" : undefined}>
        Calendar
      </a>
      <a href="/schedule/goals" aria-current={active === "goals" ? "page" : undefined}>
        Goals
      </a>
    </nav>
  );
}
