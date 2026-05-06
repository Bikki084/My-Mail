import { listPaymentNotes } from "./actions";
import { PaymentNotesClient } from "./payment-notes-client";

export const dynamic = "force-dynamic";

export default async function PaymentNotesPage() {
  const result = await listPaymentNotes();
  if (!result.ok) {
    return <PaymentNotesClient rows={[]} fetchError={result.error} />;
  }
  return <PaymentNotesClient rows={result.data ?? []} />;
}
