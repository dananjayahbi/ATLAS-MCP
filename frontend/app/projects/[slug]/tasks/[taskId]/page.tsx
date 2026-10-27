import { TaskDetail } from "@/components/tasks/task-detail";

/** Doc 06 §2.1 — `/projects/[slug]/tasks/[taskId]` deep link into the focused pane. */
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; taskId: string }> }) {
  const { taskId } = await params;
  return (
    <div className="h-full min-h-0 overflow-auto">
      <TaskDetail taskId={taskId} />
    </div>
  );
}
