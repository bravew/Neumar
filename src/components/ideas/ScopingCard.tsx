export function ScopingCard({
  title,
  questions,
  onSubmit,
}: {
  title: string;
  questions: readonly [string, string, string] | readonly string[];
  onSubmit: (answers: string[]) => void;
}) {
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit(
          questions.map((_, index) => String(data.get(`q${index}`) ?? '')),
        );
      }}
    >
      <p className="text-sm font-medium">{title}</p>
      {questions.slice(0, 3).map((question, index) => (
        <label key={question} className="block text-xs">
          {question}
          <input
            name={`q${index}`}
            defaultValue=""
            className="border-input bg-background mt-1 h-8 w-full rounded-md border px-2"
          />
        </label>
      ))}
      <button type="submit" className="text-primary text-xs">
        {title}
      </button>
    </form>
  );
}
