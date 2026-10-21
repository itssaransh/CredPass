export default function CredentialFlow() {
  return (
    <section className="py-16 px-6 max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold text-white mb-4">How CredPass Works</h2>
      <ol className="list-decimal pl-6 space-y-3 text-[var(--color-body-dark)]">
        <li>Connect wallet → request evaluation</li>
        <li>Backend queries SQL DB → calculates tier → EIP-712 signs</li>
        <li>User stores signed credential locally</li>
        <li>Request loan → pass signature to Lending Pool contract</li>
        <li>Contract verifies → unlocks undercollateralized terms</li>
      </ol>
    </section>
  );
}
