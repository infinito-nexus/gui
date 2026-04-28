// Account hub (req 021): aggregated workspace + collaborators view for
// authenticated users. Anonymous users are redirected to the entry page
// where the LoginPrompt re-arms.
import AccountHub from "./AccountHub";

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <AccountHub />
    </main>
  );
}
