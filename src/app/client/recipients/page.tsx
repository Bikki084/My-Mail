import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function RecipientsHelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CSV & merge tags</h1>
        <p className="text-muted-foreground">
          Upload format and validation rules from the proposal.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>CSV columns</CardTitle>
          <CardDescription>
            Required: <code className="text-xs">email</code>. Optional:{" "}
            <code className="text-xs">name</code>, <code className="text-xs">c3</code>–
            <code className="text-xs">c6</code> for custom merge fields.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Duplicate emails and malformed addresses are filtered at parse time in the new campaign
            flow (client-side PapaParse). Per-recipient status appears in sending logs after the
            BullMQ worker runs.
          </p>
          <p>
            Merge syntax: <code className="text-foreground">{"{{{email}}}"}</code>,{" "}
            <code className="text-foreground">{"{{{name}}}"}</code>, through{" "}
            <code className="text-foreground">{"{{{c6}}}"}</code>.
          </p>
          <Link
            href="/client/campaigns/new"
            className={cn(buttonVariants({ variant: "default" }))}
          >
            Open campaign composer
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
