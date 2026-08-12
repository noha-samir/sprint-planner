export type SquadMembershipRole = "em" | "editor" | "reviewer";

export interface SquadEntitlement {
  squadId: string;
  name?: string;
  role: SquadMembershipRole;
}

export interface ResolvedEntitlements {
  globalAdmin: boolean;
  memberships: SquadEntitlement[];
}
