import { EmptyState, PageHeader } from '../ui';

/** Nav destination that is not built yet: explain why instead of hiding it. */
export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <section className="card">
        <EmptyState title={`${title} is not built yet`}>
          This screen arrives in {phase}. Track progress in docs/progress.md.
        </EmptyState>
      </section>
    </>
  );
}
