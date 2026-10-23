export interface AccountQuota {
  available: number;
  paidRemaining: number;
  dailyRemaining: number;
  totalRemaining: number;
  bonusRemaining: number;
  invited: number;
  activated: number;
  invitationLimit: number;
}
