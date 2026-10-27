import { ProjectWorkspace } from "@/components/board/project-workspace";

/** Doc 06 §2.1 — `/projects/[slug]` board | list | matrix. */
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="h-full min-h-0 overflow-auto">
      <ProjectWorkspace slug={slug} />
    </div>
  );
}
