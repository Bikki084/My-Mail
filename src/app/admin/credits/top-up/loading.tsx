import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function TopUpCreditsLoading() {
  return (
    <>
      <AdminPageHeader
        title="Top-up Credits"
        description="Add credits to an existing client after offline payment."
      />
      <div className="max-w-lg space-y-6 rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm p-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-12 bg-gray-700" />
          <Skeleton className="h-10 w-full bg-gray-700" />
          <Skeleton className="h-11 w-full bg-gray-700" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28 bg-gray-700" />
          <Skeleton className="h-10 w-full bg-gray-700" />
          <Skeleton className="h-3 w-full max-w-md bg-gray-700" />
        </div>
        <Skeleton className="h-10 w-36 bg-gray-700" />
      </div>
    </>
  );
}
