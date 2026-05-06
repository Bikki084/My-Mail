export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-gray-400">{description}</p>
      ) : null}
    </div>
  );
}
