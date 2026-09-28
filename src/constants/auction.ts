export function getBidStep(currentBid: number): number {
  const bid = Number.isFinite(currentBid) ? currentBid : 0;
  return bid >= 250 ? 10 : bid >= 100 ? 5 : 2;
}

export function getMinNextBid(currentBid: number, hasHighestBidder: boolean): number {
  return hasHighestBidder ? currentBid + getBidStep(currentBid) : currentBid;
}
