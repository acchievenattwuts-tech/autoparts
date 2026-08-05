import KnowledgeLoadingSkeleton, {
  SkeletonStatCards,
  SkeletonTable,
} from "../KnowledgeLoadingSkeleton";

export default function KnowledgeSyncLoading() {
  return (
    <KnowledgeLoadingSkeleton label="กำลังโหลดสถานะ Sync">
      <div className="space-y-5">
        <SkeletonStatCards count={4} />
        <SkeletonTable rows={10} />
      </div>
    </KnowledgeLoadingSkeleton>
  );
}
