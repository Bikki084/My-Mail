import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";

export default function NewCampaignPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-muted-foreground">
          Upload recipients, compose HTML/text, then save. Queue sending from the API when Redis +
          BullMQ worker are running.
        </p>
      </div>
      <NewCampaignForm />
    </div>
  );
}
