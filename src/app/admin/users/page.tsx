import { listClientUsers } from "./actions";
import { UsersClient } from "./users-client";

export default async function AdminUsersPage() {
  const result = await listClientUsers();
  const initialRows = result.ok ? (result.data ?? []) : [];
  return <UsersClient initialRows={initialRows} />;
}
