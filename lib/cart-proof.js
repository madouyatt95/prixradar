function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function verifiedCartEvidence(value) {
  try {
    const cart = record(JSON.parse(value));
    return cart !== null
      && cart.status === "confirmed"
      && cart.verified === true
      && cart.consistent === true
      && cart.identityConfirmed === true
      && cart.explicitShipping === true
      && cart.explicitTotal === true
      && cart.couponApplied === true
      && typeof cart.finalTotalCents === "number"
      && Number.isSafeInteger(cart.finalTotalCents)
      && cart.finalTotalCents > 0;
  } catch {
    return false;
  }
}
