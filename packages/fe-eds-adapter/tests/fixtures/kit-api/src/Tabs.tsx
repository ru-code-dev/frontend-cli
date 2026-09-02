export const HandRolledTabs = ({ items }: { items: string[] }) => (
  <div role="tablist" aria-label="Sections">
    {items.map((item) => (
      <div key={item} role="tab" tabIndex={0}>
        {item}
      </div>
    ))}
  </div>
);
