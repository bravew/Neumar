export function InstallToolsStep({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{body}</p>
    </div>
  );
}
